import { sql, cors, parseBody } from './auth.js';
import { makeSalt, hashCode, verifyCode } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/memberClaim — the one deliberately UNAUTHENTICATED
  admin action: it is how a member gets a credential in the first place.

  { trigram, invite, code } → verifies the ONE-TIME invite a manager
  issued, sets the member's password, burns the invite.

  INVITE-ONLY (Travis, 2 Sep 2026): nobody can claim just by being in
  the registry any more. A manager issues a one-time code from the
  Staff tab and sends it to the person themselves; it expires after 7
  days and dies on first use. Redeeming it with a fresh invite also
  works for a member who ALREADY has a password — that is the reset
  path, and their old password keeps working until the moment the new
  one lands.

  Password policy, enforced here (the client meter is a courtesy):
  at least 10 characters, at least one number, at least one symbol.

  Codes and invites are stored as scrypt(x, salt) only. This handler
  must never echo, log, or store either plaintext.
*/
const TRIGRAM = /^[A-Za-z]{3}$/;
const INVITE_DAYS = 7;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = parseBody(req);
  const trigram = String(b.trigram || '').trim().toUpperCase();
  const invite = String(b.invite || '').trim().toUpperCase();
  const code = String(b.code || '');
  if (!TRIGRAM.test(trigram)) return res.status(400).json({ error: 'Trigrams are three letters' });
  if (!invite || invite.length > 20) return res.status(400).json({ error: 'The one-time invite code from your manager is required' });
  if (code !== code.trim() || code.length > 64) {
    return res.status(400).json({ error: 'Passwords have no leading or trailing spaces, 64 characters max' });
  }
  if (code.length < 10 || !/[0-9]/.test(code) || !/[^A-Za-z0-9]/.test(code)) {
    return res.status(400).json({ error: 'Passwords need at least 10 characters, with at least one number and one symbol' });
  }

  try {
    const rows = await sql`
      SELECT id, name, invite_hash, invite_salt, invited_at FROM team_members
      WHERE active = true AND trigram = ${trigram} LIMIT 1`;
    if (!rows.length) {
      return res.status(404).json({ error: 'No team member with that trigram — a manager adds you on the Staff tab first' });
    }
    const m = rows[0];
    if (!m.invite_hash) {
      return res.status(403).json({ error: 'Member access is invite-only — ask a manager for your one-time code' });
    }
    const age = m.invited_at ? (Date.now() - new Date(m.invited_at).getTime()) : Infinity;
    if (age > INVITE_DAYS * 24 * 3600 * 1000) {
      return res.status(410).json({ error: 'That invite has expired — ask a manager for a fresh one' });
    }
    if (!verifyCode(invite, m.invite_salt, m.invite_hash)) {
      return res.status(403).json({ error: 'That invite code is not right' });
    }
    const salt = makeSalt();
    const hash = hashCode(code, salt);
    await sql`UPDATE team_members
      SET code_hash = ${hash}, code_salt = ${salt}, claimed_at = now(),
          invite_hash = '', invite_salt = '', invited_at = NULL
      WHERE id = ${m.id}`;
    await logChange({ label: `${m.name} (gate)` }, 'projects',
      `${m.name} redeemed their invite and set a password (${trigram})`);
    return res.status(200).json({ ok: true, name: m.name });
  } catch (err) {
    return res.status(500).json({ error: 'Claim failed — has Setup been run?', detail: String(err) });
  }
}
