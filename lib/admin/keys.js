import { randomBytes } from 'node:crypto';
import { sql, requireScope, cors, parseBody, SCOPES } from './auth.js';

/*
  POST /api/admin/keys — manage scoped access keys. System scope (in
  practice: master) only.

  { op: 'list' }                          → every key, MASKED. The full value
                                            is shown exactly once, at create.
  { op: 'create', label, scopes: [...] }  → mints a key. Alphanumeric only —
                                            the '#'-truncates-URLs and
                                            '+'-becomes-space lessons from the
                                            session key both came from
                                            non-alphanumeric characters, and
                                            a rule with no exceptions cannot
                                            be half-remembered.
  { op: 'revoke', key }                   → active=false. Not deleted, so the
                                            label and history remain and the
                                            same string can never be re-minted
                                            with different scopes.
  { op: 'restore', key }                  → active=true.
*/
function mintKey() {
  // ~186 bits from 32 bytes, base64url with the punctuation stripped.
  return 'cr-' + randomBytes(32).toString('base64url').replace(/[-_]/g, '').slice(0, 30);
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'system');
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'list') {
      const rows = await sql`
        SELECT key, label, scopes, active,
               to_char(created_at, 'YYYY-MM-DD') AS created_at,
               to_char(last_used, 'YYYY-MM-DD HH24:MI') AS last_used
        FROM admin_keys ORDER BY created_at ASC`;
      return res.status(200).json({
        keys: rows.map(r => ({ ...r, key: r.key.slice(0, 8) + '…' })),
        scopes: SCOPES,
      });
    }

    if (op === 'create') {
      const label = (b.label || '').toString().trim().slice(0, 80);
      const scopes = (Array.isArray(b.scopes) ? b.scopes : []).filter(s => SCOPES.includes(s));
      if (!label) return res.status(400).json({ error: 'Label is required — say who or what this key is for' });
      if (!scopes.length) return res.status(400).json({ error: 'Pick at least one scope', scopes: SCOPES });
      // 'system' can close the room and mint more keys; only a master key
      // holder is even in this handler, but minting a second master-tier key
      // should be a deliberate act, not a checkbox slip.
      if (scopes.includes('system') && b.confirmSystem !== true) {
        return res.status(400).json({ error: "The 'system' scope needs confirmSystem: true — it can close the room and mint keys" });
      }
      const key = mintKey();
      await sql`INSERT INTO admin_keys (key, label, scopes) VALUES (${key}, ${label}, ${scopes}::text[])`;
      // The one and only time the full key is returned.
      return res.status(200).json({ ok: true, key, label, scopes });
    }

    if (op === 'revoke' || op === 'restore') {
      const prefix = (b.key || '').toString().replace(/…$/, '').trim();
      if (prefix.length < 8) return res.status(400).json({ error: 'Need at least the first 8 characters of the key' });
      const matches = await sql`SELECT key FROM admin_keys WHERE key LIKE ${prefix + '%'}`;
      if (!matches.length) return res.status(404).json({ error: 'No key with that prefix' });
      if (matches.length > 1) return res.status(409).json({ error: 'Prefix matches more than one key — give more characters' });
      await sql`UPDATE admin_keys SET active = ${op === 'restore'} WHERE key = ${matches[0].key}`;
      return res.status(200).json({ ok: true, op, key: prefix + '…' });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'create', 'revoke', 'restore'] });
  } catch (err) {
    res.status(500).json({ error: 'Key operation failed — has migrate been run?', detail: String(err) });
  }
}
