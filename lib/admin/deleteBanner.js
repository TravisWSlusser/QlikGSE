import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/deleteBanner — retire (active=false), never destroy.
  A board must keep at least one active banner: the rotators build once from
  whatever arrives, and an empty feed means the page silently falls back to
  the hardcoded array — which would quietly resurrect copy someone thought
  they had replaced. Refusing the last one keeps the live site honest.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'banners');
  if (!who) return;

  const id = Number(parseBody(req).id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });

  try {
    const rows = await sql`SELECT board, title FROM banners WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return res.status(404).json({ error: 'No such banner', id });
    const board = rows[0].board;

    const remaining = await sql`
      SELECT count(*)::int AS n FROM banners
      WHERE board = ${board} AND active = true AND id <> ${id}`;
    if (remaining[0].n === 0) {
      return res.status(409).json({
        error: 'Cannot retire the last active banner on a board',
        detail: 'The page would fall back to its old hardcoded copy. Add or restore another banner first.'
      });
    }

    await sql`UPDATE banners SET active = false, updated_at = now() WHERE id = ${id}`;
    await logChange(who, 'banners', `Retired ${board} post “${String(rows[0].title).replace(/<[^>]*>/g, '').slice(0, 50)}”`);
    res.status(200).json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
