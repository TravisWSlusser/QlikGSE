import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/command/banners?board=highlights|stellar — the hero rotator feed.

  Returns { posts: [...] } where each post matches the page's own literal
  shape: highlights entries can carry date (display text), cta (an array —
  the page accepts object-or-array, this always sends the array form) and
  image; stellar renders kicker/title/body only, but extra fields are
  harmless there.

  Same failure contract as events: an empty or errored feed returns
  { posts: [] }, which the pages treat as "keep the hardcoded fallback".
  Write-path sanitisation lives in saveBanner; this endpoint serves what is
  stored, verbatim, because title is raw HTML by design.
*/
const BOARDS = ['highlights', 'stellar'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const board = (req.query.board || '').toString();
  if (!BOARDS.includes(board)) return res.status(400).json({ error: 'Bad board', boards: BOARDS });

  try {
    const rows = await sql`
      SELECT kicker, title, body, date_text, ctas, image_url
      FROM banners WHERE board = ${board} AND active = true
      ORDER BY sort ASC, id ASC`;

    const posts = rows.map(r => {
      const p = { kicker: r.kicker, title: r.title, body: r.body };
      if (r.date_text) p.date = r.date_text;
      const ctas = Array.isArray(r.ctas) ? r.ctas : [];
      if (ctas.length) p.cta = ctas;
      if (r.image_url) p.image = r.image_url;
      return p;
    });

    // Cache only success — a cached degraded response pins an empty feed on
    // the edge long after the database recovered (see events.js).
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ posts });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ posts: [], degraded: true });
  }
}
