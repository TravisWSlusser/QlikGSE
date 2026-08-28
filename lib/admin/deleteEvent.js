import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/deleteEvent — retire, not destroy. active=false takes the
  event off the public feed; the row (and its long-form copy) stays, and
  saveEvent with active=true brings it back. There is no hard delete on
  purpose — the calendar is org-facing history and "nothing is destroyed"
  has already paid for itself once in this codebase.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'calendar');
  if (!who) return;

  const id = Number(parseBody(req).id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });

  try {
    const rows = await sql`
      UPDATE events SET active = false, updated_at = now()
      WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'No such event', id });
    res.status(200).json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
