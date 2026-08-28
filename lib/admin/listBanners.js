import { sql, requireScope, cors } from './auth.js';

/*
  GET /api/admin/listBanners[?board=highlights|stellar] — all rows including
  retired, in display order. The public read serves active only.
*/
const BOARDS = ['highlights', 'stellar'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'banners');
  if (!who) return;

  const board = (req.query.board || '').toString();
  if (board && !BOARDS.includes(board)) return res.status(400).json({ error: 'Bad board', boards: BOARDS });

  try {
    const rows = board
      ? await sql`SELECT id, board, kicker, title, body, date_text, ctas, image_url, sort, active, updated_at
                  FROM banners WHERE board = ${board} ORDER BY sort ASC, id ASC`
      : await sql`SELECT id, board, kicker, title, body, date_text, ctas, image_url, sort, active, updated_at
                  FROM banners ORDER BY board ASC, sort ASC, id ASC`;
    res.status(200).json({ banners: rows, boards: BOARDS });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err) });
  }
}
