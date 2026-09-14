import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

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
  const end_date = (b.end_date || '').toString().trim() || null;
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
  // Optional end date makes a multi-day span (end is the LAST day, inclusive).
  // Same reality checks as the start, plus ordering and a typo guard: a span
  // over 31 days is almost certainly a wrong year or month, not an event.
  if (end_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return res.status(400).json({ error: 'Bad end date — need YYYY-MM-DD' });
    const [ey, em, ed] = end_date.split('-').map(Number);
    const edt = new Date(ey, em - 1, ed);
    if (edt.getFullYear() !== ey || edt.getMonth() !== em - 1 || edt.getDate() !== ed) {
      return res.status(400).json({ error: 'That end date does not exist' });
    }
    if (end_date <= date) return res.status(400).json({ error: 'End date must be after the start — leave it blank for a single day' });
    if ((edt - dt) / 86400000 > 31) return res.status(400).json({ error: 'That span is over a month — check the end date' });
  }
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (link && !/^https:\/\//.test(link)) return res.status(400).json({ error: 'Link must be https://' });
  // Caps sized to what the surfaces can hold: the chip strip truncates a
  // long title, and detail feeds the chip expansion + calendar pop-up.
  // Reject, never silently truncate.
  for (const [field, value, cap] of [
    ['Title', title, 80], ['Detail', detail, 600],
    ['Long-form copy', full_copy, 5000], ['Link', link, 500],
  ]) {
    if (value.length > cap) {
      return res.status(400).json({ error: `${field} is ${value.length} characters — the limit is ${cap}` });
    }
  }

  try {
    const cat = await sql`SELECT key FROM event_categories WHERE key = ${category} LIMIT 1`;
    if (!cat.length) return res.status(400).json({ error: 'Unknown category', category });

    let row;
    // end_date is a v10 column: on a pre-Setup database the rich statement
    // fails, and a save WITHOUT an end date must still work (deploy lands
    // before anyone runs Setup). A save WITH one gets told to update first.
    try {
      if (id) {
        const rows = await sql`
          UPDATE events SET date = ${date}, end_date = ${end_date}, category = ${category},
            title = ${title}, detail = ${detail}, full_copy = ${full_copy}, link = ${link},
            pin = ${pin}, active = ${active}, updated_at = now()
          WHERE id = ${id}
          RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such event', id });
        row = rows[0];
      } else {
        const rows = await sql`
          INSERT INTO events (date, end_date, category, title, detail, full_copy, link, pin, active)
          VALUES (${date}, ${end_date}, ${category}, ${title}, ${detail}, ${full_copy}, ${link}, ${pin}, ${active})
          RETURNING id`;
        row = rows[0];
      }
    } catch (err) {
      if (!/end_date/.test(String(err))) throw err;
      if (end_date) return res.status(400).json({ error: 'Multi-day events need the latest update — run Setup under Maintenance first' });
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
    }
    await logChange(who, 'calendar', `${id ? 'Updated' : 'Created'} event “${title}” (${date}${end_date ? '→' + end_date : ''})`);
    res.status(200).json({ ok: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
