import { sql, requireScope, cors } from './auth.js';

/*
  GET /api/admin/listLog — the recent-changes feed for the Home screen.
  Any valid key: everyone who can edit anything can see what changed, which
  is how a shared tool stays coordinated.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, null);
  if (!who) return;

  try {
    const rows = await sql`
      SELECT actor, action, summary,
             to_char(created_at, 'Mon DD, HH24:MI') AS at
      FROM admin_log ORDER BY id DESC LIMIT 40`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ log: rows });
  } catch {
    // Table not created yet — an empty feed, not an error.
    res.status(200).json({ log: [], pending: true });
  }
}
