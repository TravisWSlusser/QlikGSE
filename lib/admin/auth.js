import { neon } from '@neondatabase/serverless';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
export const sql = neon(CONN);

/*
  Access control for the Control Room (/api/admin/*).

  Two sources of truth, checked in order:

    1. ADMIN_KEY env var — the master key(s). Comma-separated list, same
       rotation pattern as MT_SESSION_REF. A master key holds every scope.
       This is also the bootstrap: the admin_keys table cannot be created or
       populated except by someone already holding a master key.

    2. admin_keys table — per-person / per-role keys with an explicit scope
       list, so an SME key can open the question banks and nothing else.
       Created by `migrate`, managed by `keys`, both master-only.

  Scopes:
    calendar   events + categories
    banners    hero rotators + image upload
    content    question banks (all three tables)
    analytics  player + game data (read-only)
    system     maintenance switch, keys, migrate

  Unlike the session key, admin keys never ride in a URL — they arrive in the
  x-admin-key header (or the POST body for clients that cannot set headers),
  so they stay out of history, logs and referrers. Trim-tolerant because they
  are pasted by hand; nothing else, because they never cross a query string.

  This gate FAILS CLOSED, like EXPORT_KEY and unlike getAppState: no
  ADMIN_KEY configured means nobody gets in, including the table path —
  a database that can be reached without a master key existing is not a
  fallback, it is a hole.
*/

export const SCOPES = ['calendar', 'banners', 'content', 'analytics', 'projects', 'system'];

/*
  Member access codes (phase 2 of the team registry). A member signs in
  with `TRI:code`; the code is theirs to choose (claimed at the gate once
  an admin has put them in team_members) and is stored ONLY as
  scrypt(code, salt) — never plaintext, never logged, never echoed.
  A member session carries NO scopes: it passes every requireScope(null)
  read (and the Community Board, which is deliberately any-key), and
  lib/admin/projects.js additionally lets it move projects it is TAGGED
  on. Everything scoped stays closed to it.
*/
export const makeSalt = () => randomBytes(16).toString('hex');
export const hashCode = (code, salt) => scryptSync(code, salt, 32).toString('hex');
export function verifyCode(code, salt, hash) {
  try {
    const a = scryptSync(code, salt, 32);
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

function submittedKey(req) {
  const h = req.headers && (req.headers['x-admin-key'] || req.headers['X-Admin-Key']);
  if (typeof h === 'string' && h.trim()) return h.trim();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (body && typeof body.key === 'string' && body.key.trim()) return body.key.trim();
  return '';
}

function masterKeys() {
  return (process.env.ADMIN_KEY || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

/*
  ULTRA_ADMIN_KEY — Travis's break-glass key. Checked INDEPENDENTLY of
  ADMIN_KEY, before it and regardless of it, so no change to the normal
  master key (rotated, cleared, mistyped into the env) can ever lock him
  out. Same powers as a master key; the only difference is the label —
  changes made with it read as "ultra" in the change feed, so break-glass
  use is always distinguishable after the fact.

  Env-only, forever, for the same trust-root reason as ADMIN_KEY — and it
  must never be printed, logged, emailed, or echoed back by anything.
*/
function ultraKeys() {
  return (process.env.ULTRA_ADMIN_KEY || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

/*
  Resolve the caller. Returns { ok:true, label, scopes:[...] } or
  { ok:false, status, error }. Never throws — a database failure while
  checking a table key reads as "not a valid key", not a 500, because an
  auth check that can error into either state is untrustworthy in both.
*/
export async function identify(req) {
  const key = submittedKey(req);
  if (!key) return { ok: false, status: 401, error: 'No admin key supplied' };

  // Break-glass first: ULTRA must admit even when ADMIN_KEY is broken.
  if (ultraKeys().includes(key)) {
    return { ok: true, label: 'ultra', scopes: SCOPES.slice(), master: true };
  }

  const masters = masterKeys();
  if (masters.length === 0 && ultraKeys().length === 0) {
    // Fail closed, and say why in a way that helps the one person who can
    // fix it (this reads as "go set the env var", not as a key oracle).
    return { ok: false, status: 401, error: 'ADMIN_KEY is not configured on the server' };
  }
  if (masters.includes(key)) {
    return { ok: true, label: 'master', scopes: SCOPES.slice(), master: true };
  }

  try {
    const rows = await sql`
      SELECT label, scopes FROM admin_keys
      WHERE key = ${key} AND active = true LIMIT 1
    `;
    if (rows.length) {
      // Non-fatal bookkeeping; a failed timestamp must not fail the request.
      try { await sql`UPDATE admin_keys SET last_used = now() WHERE key = ${key}`; } catch {}
      const scopes = (rows[0].scopes || []).filter(s => SCOPES.includes(s));
      return { ok: true, label: rows[0].label || 'unnamed key', scopes, master: false };
    }
  } catch { /* table missing or db down — fall through to 401 */ }

  // 3. Member access codes — `TRI:code`. Checked last; grants no scopes.
  //    Wrong trigram, unclaimed member, wrong code, missing table: all of
  //    them read as the same 401 below, never as an oracle.
  const mm = key.match(/^([A-Za-z]{3}):(.{1,64})$/);
  if (mm) {
    try {
      const rows = await sql`
        SELECT id, name, trigram, code_hash, code_salt FROM team_members
        WHERE active = true AND trigram = ${mm[1].toUpperCase()} AND code_hash <> '' LIMIT 1`;
      if (rows.length && verifyCode(mm[2], rows[0].code_salt, rows[0].code_hash)) {
        return {
          ok: true, label: rows[0].name, scopes: [], master: false,
          member: { id: rows[0].id, name: rows[0].name, trigram: rows[0].trigram },
        };
      }
    } catch { /* registry missing or db down — fall through to 401 */ }
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}

/*
  The per-action gate. Sends the error response itself and returns null,
  so a handler reads:

    const who = await requireScope(req, res, 'calendar');
    if (!who) return;

  `scope` may be null (any valid key), a string, or an array — an array
  means ANY of the listed scopes admits (questionStats is analytics OR
  content, because the SMEs who edit the banks need to see the misses).
*/
export async function requireScope(req, res, scope) {
  const who = await identify(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return null; }
  const need = scope == null ? [] : (Array.isArray(scope) ? scope : [scope]);
  if (need.length && !need.some(s => who.scopes.includes(s))) {
    res.status(403).json({ error: `This key does not include the '${need.join("' or '")}' scope`, scopes: who.scopes });
    return null;
  }
  return who;
}

/* Shared body parse — Vercel usually hands us an object, but not always. */
export function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

/* Standard CORS for the admin namespace. Same-origin in practice (the
   Control Room is served from this deployment), but the header costs nothing
   and keeps local file:// testing possible. x-admin-key must be allowed or
   the browser preflight strips it. */
export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
