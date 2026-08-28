import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/saveBanner — insert (no id) or update (id).

  title and body are RAW HTML by the rotators' contract (the green accent is
  <span class="ac">), so this endpoint cannot escape them — instead it
  whitelists hard: only <span class="ac">, <b>, <i>, <em>, <strong> and <br>
  survive; every other tag is stripped. Event handlers and javascript: URLs
  never get near the page. This is the write-path sanitisation the page
  itself deliberately does not do.

  Board differences the editor enforces visually but this endpoint states:
  - stellar renders kicker/body ESCAPED and ignores date_text, ctas and
    image_url entirely (no markup will render there, and nothing else shows).
  - highlights renders everything, image as a circle in a side panel that
    is hidden on mobile — never let an image carry the message.
*/
const BOARDS = ['highlights', 'stellar'];

// Keep only the inline tags the rotators were designed around.
function sanitizeHtml(s) {
  return String(s)
    // strip every tag that is not on the whitelist (closing tags included)
    .replace(/<(?!\/?(?:span|b|i|em|strong|br)\b)[^>]*>/gi, '')
    // span may only carry class="ac" — rewrite any surviving span open-tag
    .replace(/<span\b[^>]*>/gi, '<span class="ac">')
    // no attributes on anything else
    .replace(/<(b|i|em|strong|br)\b[^>]*>/gi, '<$1>');
}

function cleanCtas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map(c => ({
    label: (c && c.label ? String(c.label) : '').slice(0, 80).trim(),
    href: (c && c.href ? String(c.href) : '').trim(),
  })).filter(c => c.label && /^https:\/\//.test(c.href));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'banners');
  if (!who) return;

  const b = parseBody(req);
  const id = b.id == null ? null : Number(b.id);
  const board = (b.board || '').toString();
  const kicker = sanitizeHtml((b.kicker || '').toString()).slice(0, 120);
  const title = sanitizeHtml((b.title || '').toString()).slice(0, 300);
  const body = sanitizeHtml((b.body || '').toString()).slice(0, 1000);
  const date_text = (b.date_text || '').toString().slice(0, 60);
  const ctas = cleanCtas(b.ctas);
  const image_url = (b.image_url || '').toString().trim();
  const sort = Number.isInteger(Number(b.sort)) ? Number(b.sort) : 0;
  const active = b.active === undefined ? true : !!b.active;

  if (!BOARDS.includes(board)) return res.status(400).json({ error: 'Bad board', boards: BOARDS });
  if (!title.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'Title is required' });
  if (image_url && !/^https:\/\//.test(image_url)) return res.status(400).json({ error: 'Image URL must be https://' });

  try {
    let row;
    if (id) {
      const rows = await sql`
        UPDATE banners SET board = ${board}, kicker = ${kicker}, title = ${title},
          body = ${body}, date_text = ${date_text}, ctas = ${JSON.stringify(ctas)}::jsonb,
          image_url = ${image_url}, sort = ${sort}, active = ${active}, updated_at = now()
        WHERE id = ${id} RETURNING id`;
      if (!rows.length) return res.status(404).json({ error: 'No such banner', id });
      row = rows[0];
    } else {
      const rows = await sql`
        INSERT INTO banners (board, kicker, title, body, date_text, ctas, image_url, sort, active)
        VALUES (${board}, ${kicker}, ${title}, ${body}, ${date_text},
                ${JSON.stringify(ctas)}::jsonb, ${image_url}, ${sort}, ${active})
        RETURNING id`;
      row = rows[0];
    }
    res.status(200).json({ ok: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
