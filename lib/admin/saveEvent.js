import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/saveEvent — insert (no id) or update (id).

  Validation mirrors what the calendar pages actually depend on:
  - date must be real YYYY-MM-DD; it is the join key everywhere, and the
    chips derive month/day from it server-side.
  - category must exist in event_categories, or the chip renders with no
    colour and the legend lies.
  - pin costs one of only three chip slots and bypasses the past-date
    filter — enforced socially, not here, but the editor warns.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'calendar');
  if (!who) return;

  const b = parseBody(req);
  const id = b.id == null ? null : Number(b.id);
  const date = (b.date || '').toString().trim();
  const category = (b.category || '').toString().trim();
  const title = (b.title || '').toString().trim();
  const detail = (b.detail || '').toString();
  const full_copy = (b.full_copy || '').toString();
  const link = (b.link || '').toString().trim();
  const pin = !!b.pin;
  const active = b.active === undefined ? true : !!b.active;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date — need YYYY-MM-DD' });
  // Reject the plausible-but-impossible (2026-02-31) before Postgres does,
  // with a message the editor can show as-is.
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return res.status(400).json({ error: 'That date does not exist' });
  }
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (link && !/^https:\/\//.test(link)) return res.status(400).json({ error: 'Link must be https://' });

  try {
    const cat = await sql`SELECT key FROM event_categories WHERE key = ${category} LIMIT 1`;
    if (!cat.length) return res.status(400).json({ error: 'Unknown category', category });

    let row;
    if (id) {
      const rows = await sql`
        UPDATE events SET date = ${date}, category = ${category}, title = ${title},
          detail = ${detail}, full_copy = ${full_copy}, link = ${link},
          pin = ${pin}, active = ${active}, updated_at = now()
        WHERE id = ${id}
        RETURNING id`;
      if (!rows.length) return res.status(404).json({ error: 'No such event', id });
      row = rows[0];
    } else {
      const rows = await sql`
        INSERT INTO events (date, category, title, detail, full_copy, link, pin, active)
        VALUES (${date}, ${category}, ${title}, ${detail}, ${full_copy}, ${link}, ${pin}, ${active})
        RETURNING id`;
      row = rows[0];
    }
    res.status(200).json({ ok: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
