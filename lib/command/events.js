import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/command/events — the calendar feed, in exactly the shape of
  assets/calendar/events.json (whose _comment predicted this endpoint).
  Both hero pages replace KEY_DATES wholesale from it; their hardcoded
  arrays remain the offline fallback.

  Contract sharp edges, honoured here:
  - month/day are denormalised render strings. The pages print them
    verbatim, so they are derived the same way the file kept them:
    3-letter UPPERCASE month, day with no leading zero.
  - an empty `events` array is treated by the pages as a failure and leaves
    the fallback showing — so an empty/missing table degrades to the last
    committed copy, which is the right failure mode.
  - fails soft: any error returns { events: [] } with a 200, same philosophy
    as getAppState. The calendar must never be able to blank a page.
*/
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Short shared cache: edits land within a minute without hammering Neon.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const cats = await sql`SELECT key, label, color FROM event_categories`;
    const rows = await sql`
      SELECT to_char(date, 'YYYY-MM-DD') AS date, category, title, detail,
             full_copy, link, pin
      FROM events WHERE active = true ORDER BY date ASC, id ASC`;

    const categories = {};
    for (const c of cats) categories[c.key] = { label: c.label, color: c.color };

    const events = rows.map(r => {
      const [y, m, d] = r.date.split('-');
      const e = {
        date: r.date,
        category: r.category,
        month: MONTHS[Number(m) - 1] || '',
        day: String(Number(d)),
        title: r.title,
        detail: r.detail,
        year: y,
      };
      if (r.full_copy) e.full = r.full_copy;
      if (r.link) e.link = r.link;
      if (r.pin) e.pin = true;
      return e;
    });

    res.status(200).json({ categories, events });
  } catch (err) {
    res.status(200).json({ events: [], degraded: true });
  }
}
