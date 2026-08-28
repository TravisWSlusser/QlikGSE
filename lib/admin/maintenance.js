import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  /api/admin/maintenance — the CLAUDE.md runbook's SQL, as an endpoint.

  GET  → current switch state (any valid admin key; it is not a secret,
         the whole room shows it when it is on).
  POST → flip it. { on: true|false, message?, eta? }. System scope: closing
         the room 503s every score write, which is not an SME power.

  Same semantics as the hand-run SQL: the pages poll getAppState every 45s
  and on refocus, so expect up to a minute for everyone to fall in or out.
  The switch still FAILS OPEN on the read side everywhere — this endpoint
  only writes the rows the fail-open readers look for.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;

  if (req.method === 'GET') {
    const who = await requireScope(req, res, null);
    if (!who) return;
    try {
      const rows = await sql`SELECT key, value, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
        FROM app_state WHERE key IN ('maintenance','maintenance_message','maintenance_eta')`;
      const m = {};
      for (const r of rows) m[r.key] = { value: r.value, updated_at: r.updated_at };
      res.status(200).json({
        on: ((m.maintenance || {}).value || 'off').trim().toLowerCase() === 'on',
        message: (m.maintenance_message || {}).value || '',
        eta: (m.maintenance_eta || {}).value || '',
        updated_at: (m.maintenance || {}).updated_at || null,
        tableExists: rows.length > 0,
      });
    } catch (err) {
      // Table missing = switch inert. Say so instead of erroring, so the UI
      // can point at the migrate button.
      res.status(200).json({ on: false, message: '', eta: '', tableExists: false, detail: String(err) });
    }
    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  const who = await requireScope(req, res, 'system');
  if (!who) return;

  const b = parseBody(req);
  const on = !!b.on;
  const message = (b.message == null ? null : String(b.message).slice(0, 300));
  const eta = (b.eta == null ? null : String(b.eta).slice(0, 100));

  try {
    await sql`INSERT INTO app_state (key, value) VALUES ('maintenance', ${on ? 'on' : 'off'})
      ON CONFLICT (key) DO UPDATE SET value = ${on ? 'on' : 'off'}, updated_at = now()`;
    if (message !== null) {
      await sql`INSERT INTO app_state (key, value) VALUES ('maintenance_message', ${message})
        ON CONFLICT (key) DO UPDATE SET value = ${message}, updated_at = now()`;
    }
    if (eta !== null) {
      await sql`INSERT INTO app_state (key, value) VALUES ('maintenance_eta', ${eta})
        ON CONFLICT (key) DO UPDATE SET value = ${eta}, updated_at = now()`;
    }
    res.status(200).json({ ok: true, on });
  } catch (err) {
    res.status(500).json({ error: 'Write failed — has migrate been run?', detail: String(err) });
  }
}
