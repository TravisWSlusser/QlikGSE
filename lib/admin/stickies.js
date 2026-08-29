import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/stickies — the community corkboard(s), v2.

  Two kinds of item, deliberately different physics:
  - NOTES: paper, pinned, permanent until taken down. Rotatable only.
    Author is the key label. Can collect REACTIONS (emoji or a small
    sticker) stuck to their corner — reacting requires a typed name.
  - STICKERS: bare art on the cork, no pin, no paper. Posting one requires
    a typed name; hover shows name + when. They EXPIRE 24h after pinning
    (the row stays, the list just stops serving it — party decorations,
    not records). Rotatable AND scalable (0.5x–2x).

  Transforms are SHARED STATE: rotate or resize and everyone sees the same
  board. Anyone with a key can adjust anything — it is a communal wall, and
  takedowns/pins are what the change feed polices; nudging a sticker is not
  worth a ledger line.

  Boards 1..5, navigated by arrows in the UI. Everything carries board_no.

  { op:'list', board }                                  → items + reactions
  { op:'save', board, message?, detail?, color?, sticker_url?, poster_name? }
  { op:'transform', id, rotation, scale }
  { op:'react', sticky_id, name, emoji? | sticker_url? }
  { op:'delete', id }
*/
const COLORS = ['yellow', 'pink', 'mint', 'blue', 'orange'];
const BOARDS = 5;
const GIPHY = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\//;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, null);
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();
  const boardNo = Math.min(BOARDS, Math.max(1, Math.round(Number(b.board)) || 1));

  try {
    if (op === 'list') {
      const rows = await sql`
        SELECT id, message, detail, color, author, poster_name, sticker_url,
               rotation, scale, pos_x, pos_y, created_at
        FROM stickies
        WHERE active = true AND board_no = ${boardNo}
          AND (sticker_url = '' OR created_at > now() - interval '24 hours')
        ORDER BY id DESC LIMIT 40`;
      const ids = rows.map(r => r.id);
      let reactions = [];
      if (ids.length) {
        reactions = await sql`
          SELECT sticky_id, emoji, sticker_url, name, created_at
          FROM sticky_reactions
          WHERE active = true AND sticky_id = ANY(${ids}::int[])
          ORDER BY id ASC`;
      }
      return res.status(200).json({ notes: rows, reactions, board: boardNo, boards: BOARDS });
    }

    if (op === 'save') {
      const message = (b.message || '').toString().trim();
      const detail = (b.detail || '').toString().trim();
      const color = COLORS.includes(b.color) ? b.color : COLORS[0];
      const sticker_url = (b.sticker_url || '').toString().trim();
      const poster_name = (b.poster_name || '').toString().trim();

      if (sticker_url) {
        if (!GIPHY.test(sticker_url)) return res.status(400).json({ error: 'Stickers come from GIPHY — that URL does not' });
        if (poster_name.length < 2 || poster_name.length > 40) {
          return res.status(400).json({ error: 'Stickers are signed — give your name (2–40 characters)' });
        }
      } else if (!message) {
        return res.status(400).json({ error: 'The note needs a message' });
      }
      if (message.length > 60) return res.status(400).json({ error: `The face of a note is ${message.length}/60 characters` });
      if (detail.length > 500) return res.status(400).json({ error: `Detail is ${detail.length}/500 characters` });

      const rows = await sql`
        INSERT INTO stickies (message, detail, color, author, sticker_url, poster_name, board_no)
        VALUES (${message}, ${detail}, ${color}, ${who.label}, ${sticker_url}, ${poster_name}, ${boardNo})
        RETURNING id`;
      await logChange(who, 'board', sticker_url
        ? `${poster_name} pinned a sticker on board ${boardNo}`
        : `Pinned a note on board ${boardNo}: “${message.slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'transform') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rotation = Math.max(-180, Math.min(180, Math.round(Number(b.rotation) || 0)));
      let scale = Number(b.scale);
      if (!Number.isFinite(scale)) scale = 1;
      scale = Math.max(0.5, Math.min(2, scale));
      // Free position on the board, as percentages so every screen agrees.
      const px = Number(b.pos_x), py = Number(b.pos_y);
      const pos_x = Number.isFinite(px) ? Math.max(0, Math.min(92, px)) : null;
      const pos_y = Number.isFinite(py) ? Math.max(0, Math.min(88, py)) : null;
      const cur = await sql`SELECT sticker_url FROM stickies WHERE id = ${id} AND active = true LIMIT 1`;
      if (!cur.length) return res.status(404).json({ error: 'No such item', id });
      const finalScale = cur[0].sticker_url ? scale : 1; // notes rotate only
      if (pos_x !== null && pos_y !== null) {
        await sql`UPDATE stickies SET rotation = ${rotation}, scale = ${finalScale},
          pos_x = ${pos_x}, pos_y = ${pos_y} WHERE id = ${id}`;
      } else {
        await sql`UPDATE stickies SET rotation = ${rotation}, scale = ${finalScale} WHERE id = ${id}`;
      }
      return res.status(200).json({ ok: true, id, rotation, scale: finalScale, pos_x, pos_y });
    }

    if (op === 'react') {
      const sticky_id = Number(b.sticky_id);
      const name = (b.name || '').toString().trim();
      const emoji = (b.emoji || '').toString().trim().slice(0, 8);
      const sticker_url = (b.sticker_url || '').toString().trim();
      if (!Number.isInteger(sticky_id) || sticky_id <= 0) return res.status(400).json({ error: 'Bad sticky_id' });
      if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Reactions are signed — give your name (2–40 characters)' });
      if (!emoji && !sticker_url) return res.status(400).json({ error: 'Pick an emoji or a sticker' });
      if (sticker_url && !GIPHY.test(sticker_url)) return res.status(400).json({ error: 'Sticker reactions come from GIPHY' });
      const target = await sql`SELECT id, sticker_url FROM stickies WHERE id = ${sticky_id} AND active = true LIMIT 1`;
      if (!target.length) return res.status(404).json({ error: 'That note is gone' });
      if (target[0].sticker_url) return res.status(400).json({ error: 'Reactions stick to notes, not stickers' });
      await sql`INSERT INTO sticky_reactions (sticky_id, emoji, sticker_url, name)
        VALUES (${sticky_id}, ${emoji}, ${sticker_url}, ${name})`;
      return res.status(200).json({ ok: true });
    }

    if (op === 'delete') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rows = await sql`UPDATE stickies SET active = false WHERE id = ${id} RETURNING message, author, poster_name, sticker_url`;
      if (!rows.length) return res.status(404).json({ error: 'No such note', id });
      await logChange(who, 'board', rows[0].sticker_url
        ? `Took down ${rows[0].poster_name || rows[0].author}'s sticker`
        : `Took down ${rows[0].author}'s note: “${String(rows[0].message).slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'save', 'transform', 'react', 'delete'] });
  } catch (err) {
    res.status(500).json({ error: 'Board operation failed — has Setup been run?', detail: String(err) });
  }
}
