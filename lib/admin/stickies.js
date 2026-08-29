import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/stickies — the community corkboard on CAPCOM's Home.

  Digital sticky notes: a short face (what you read on the board) and a
  longer detail (what the hover reveals). For jokes, deserved shout-outs,
  spotted bugs, heads-ups, questions — the hallway wall of the ops room.

  Any valid key posts; any valid key can take a note down (removals are
  logged with the remover's label, which is the whole moderation model —
  same social contract as the hotlinks bar). Notes are soft-deleted.

  { op: 'list' }                                   → newest 30 active
  { op: 'save', message, detail?, color? }         → pin a note
  { op: 'delete', id }                             → take one down
*/
const COLORS = ['yellow', 'pink', 'mint', 'blue', 'orange'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, null);
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'list') {
      const rows = await sql`
        SELECT id, message, detail, color, author, sticker_url, created_at FROM stickies
        WHERE active = true ORDER BY id DESC LIMIT 30`;
      return res.status(200).json({ notes: rows });
    }

    if (op === 'save') {
      const message = (b.message || '').toString().trim();
      const detail = (b.detail || '').toString().trim();
      const color = COLORS.includes(b.color) ? b.color : COLORS[0];
      const sticker_url = (b.sticker_url || '').toString().trim();
      // A board item is a paper NOTE or a pinned STICKER — a sticker needs
      // no message (its caption, if any, rides in detail for the hover).
      if (sticker_url && !/^https:\/\/([a-z0-9-]+\.)*giphy\.com\//.test(sticker_url)) {
        return res.status(400).json({ error: 'Stickers come from GIPHY — that URL does not' });
      }
      if (!message && !sticker_url) return res.status(400).json({ error: 'The note needs a message' });
      if (message.length > 60) return res.status(400).json({ error: `The face of a note is ${message.length}/60 characters — the detail is where the long part goes` });
      if (detail.length > 500) return res.status(400).json({ error: `Detail is ${detail.length}/500 characters` });

      const rows = await sql`
        INSERT INTO stickies (message, detail, color, author, sticker_url)
        VALUES (${message}, ${detail}, ${color}, ${who.label}, ${sticker_url}) RETURNING id`;
      await logChange(who, 'board', sticker_url
        ? `Pinned a sticker${message ? `: “${message.slice(0, 40)}”` : ''}`
        : `Pinned a note: “${message.slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'delete') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rows = await sql`UPDATE stickies SET active = false WHERE id = ${id} RETURNING message, author, sticker_url`;
      if (!rows.length) return res.status(404).json({ error: 'No such note', id });
      await logChange(who, 'board', rows[0].sticker_url && !rows[0].message
        ? `Took down ${rows[0].author}'s sticker`
        : `Took down ${rows[0].author}'s note: “${String(rows[0].message).slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'save', 'delete'] });
  } catch (err) {
    res.status(500).json({ error: 'Board operation failed — has Setup been run?', detail: String(err) });
  }
}
