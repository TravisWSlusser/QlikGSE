import { sql, requireScope, cors } from './auth.js';

/*
  GET /api/admin/listEvents — every event including retired ones (the public
  read at /api/command/events serves active only). Categories ride along so
  the editor has one round trip.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'calendar');
  if (!who) return;

  try {
    const events = await sql`
      SELECT id, to_char(date, 'YYYY-MM-DD') AS date, category, title, detail,
             full_copy, link, pin, active, updated_at
      FROM events ORDER BY date ASC, id ASC
    `;
    const categories = await sql`SELECT key, label, color FROM event_categories ORDER BY key`;
    res.status(200).json({ events, categories });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err) });
  }
}
