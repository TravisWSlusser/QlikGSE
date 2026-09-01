import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/stickies — the community corkboard(s), v2.

  Three kinds of item, deliberately different physics — and ALL of them
  signed with a typed real name (poster_name); `author` keeps the key
  label for the audit trail only, never for display:
  - NOTES: paper, pinned, permanent until taken down. Rotatable only.
    Can collect REACTIONS (emoji or a small sticker) stuck to their
    corner — reacting requires a typed name too.
  - STICKERS: bare art on the cork, no pin, no paper. Posting one requires
    a typed name; hover shows name + when. They EXPIRE 24h after pinning
    (the row stays, the list just stops serving it — party decorations,
    not records). Rotatable AND scalable (0.5x–2x).
  - BOOKMARKS: a manila folder with a link's title on it (message = title,
    link_url = destination, http/https only). Permanent like notes,
    rotatable only, and they take reactions and yarn like notes do —
    the server treats them as notes everywhere except save validation.

  Transforms are SHARED STATE: rotate or resize and everyone sees the same
  board. Anyone with a key can adjust anything — it is a communal wall, and
  takedowns/pins are what the change feed polices; nudging a sticker is not
  worth a ledger line.

  Boards 1..5, navigated by arrows in the UI. Everything carries board_no.

  YARN ties two items on the same board together with a colored string —
  the conspiracy-wall move: ideas connect. Yarn is shared state; anyone
  with a key can tie, recolor, or cut. Cutting is a soft delete. Yarn
  whose either end is taken down (or expires) simply stops being served —
  the rows keep it, the list's endpoint filter drops it.

  { op:'list', board }                          → items + reactions + yarn
  { op:'save', board, message?, detail?, color?, sticker_url?, poster_name? }
  { op:'transform', id, rotation, scale }
  { op:'react', sticky_id, name, emoji? | sticker_url? }
  { op:'tie', from_id, to_id, color, board }
  { op:'yarn_color', id, color }
  { op:'cut', id }
  { op:'delete', id }
*/
const COLORS = ['yellow', 'pink', 'mint', 'blue', 'orange'];
const YARN_COLORS = ['red', 'orange', 'teal', 'purple', 'white'];
const BOARDS = 5;
const GIPHY = /^https:\/\/([a-z0-9-]+\.)*giphy\.com\//;

/* Board economy:
   - CAP_ITEMS per board; a full board refuses new pins outright.
   - STICKER_CAP per board; a new sticker past the cap AUTO-BUMPS the one
     closest to expiring (stickers die at 24h, so closest-to-expiry = the
     oldest) rather than refusing — decorations rotate, they don't queue.
   - Board N+1 UNLOCKS when board N holds ≥ UNLOCK_AT items (50% of
     capacity). Unlocking never goes backwards past content: a board that
     already has items stays reachable even if earlier boards thin out. */
const CAP_ITEMS = 18;
const STICKER_CAP = 10;
const UNLOCK_AT = 9;

async function boardCounts() {
  const rows = await sql`
    SELECT board_no, count(*)::int AS items,
           count(*) FILTER (WHERE sticker_url <> '')::int AS stickers
    FROM stickies
    WHERE active = true AND (sticker_url = '' OR created_at > now() - interval '24 hours')
    GROUP BY board_no`;
  const map = {};
  for (const r of rows) map[r.board_no] = { items: r.items, stickers: r.stickers };
  let unlocked = 1;
  for (let i = 1; i < BOARDS; i++) {
    if ((map[i] || {}).items >= UNLOCK_AT) unlocked = i + 1; else break;
  }
  for (const k of Object.keys(map)) unlocked = Math.max(unlocked, Number(k)); // never strand content
  return { map, unlocked: Math.min(unlocked, BOARDS) };
}

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
               link_url, rotation, scale, pos_x, pos_y, created_at
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
      let yarn = [];
      if (ids.length) {
        try {
          yarn = await sql`
            SELECT id, from_id, to_id, color FROM sticky_yarn
            WHERE active = true AND board_no = ${boardNo}
              AND from_id = ANY(${ids}::int[]) AND to_id = ANY(${ids}::int[])
            ORDER BY id ASC`;
        } catch { /* pre-Setup: no yarn table yet — the board still serves */ }
      }
      const bc = await boardCounts();
      const cur = bc.map[boardNo] || { items: 0, stickers: 0 };
      return res.status(200).json({
        notes: rows, reactions, yarn, board: boardNo, boards: BOARDS,
        unlocked: bc.unlocked, count: cur.items, stickerCount: cur.stickers,
        caps: { items: CAP_ITEMS, stickers: STICKER_CAP, unlockAt: UNLOCK_AT },
      });
    }

    if (op === 'save') {
      const message = (b.message || '').toString().trim();
      const detail = (b.detail || '').toString().trim();
      const color = COLORS.includes(b.color) ? b.color : COLORS[0];
      const sticker_url = (b.sticker_url || '').toString().trim();
      const poster_name = (b.poster_name || '').toString().trim();
      const link_url = (b.link_url || '').toString().trim();

      if (link_url) {
        if (sticker_url) return res.status(400).json({ error: 'A bookmark cannot also be a sticker' });
        if (link_url.length > 500 || !/^https?:\/\/\S+$/i.test(link_url)) {
          return res.status(400).json({ error: 'Bookmarks need a working http(s) link' });
        }
        if (!message) return res.status(400).json({ error: 'The folder needs a title' });
      }
      if (sticker_url) {
        if (!GIPHY.test(sticker_url)) return res.status(400).json({ error: 'Stickers come from GIPHY — that URL does not' });
      } else if (!message) {
        return res.status(400).json({ error: 'The note needs a message' });
      }
      // EVERYTHING on the board is signed with a real name — the key label
      // ("master", a team key) is for the audit trail, not the paper
      if (poster_name.length < 2 || poster_name.length > 40) {
        return res.status(400).json({ error: 'The board is signed — give your name (2–40 characters)' });
      }
      if (message.length > 60) return res.status(400).json({ error: `The face of a note is ${message.length}/60 characters` });
      if (detail.length > 500) return res.status(400).json({ error: `Detail is ${detail.length}/500 characters` });

      const bc = await boardCounts();
      if (boardNo > bc.unlocked) {
        const prev = (bc.map[boardNo - 1] || {}).items || 0;
        return res.status(403).json({
          error: `Board ${boardNo} is locked — board ${boardNo - 1} unlocks it at ${UNLOCK_AT} items (${prev}/${UNLOCK_AT} so far)`,
        });
      }
      const cur = bc.map[boardNo] || { items: 0, stickers: 0 };
      if (cur.items >= CAP_ITEMS) {
        return res.status(409).json({ error: `Board ${boardNo} is full (${CAP_ITEMS} items). Take something down, or fill toward the next board.` });
      }
      // Sticker cap: bump the one closest to expiring (= oldest) to make room.
      if (sticker_url && cur.stickers >= STICKER_CAP) {
        const bumped = await sql`
          UPDATE stickies SET active = false
          WHERE id = (
            SELECT id FROM stickies
            WHERE active = true AND board_no = ${boardNo} AND sticker_url <> ''
              AND created_at > now() - interval '24 hours'
            ORDER BY created_at ASC LIMIT 1
          ) RETURNING poster_name`;
        if (bumped.length) {
          await logChange(who, 'board', `Board ${boardNo} at sticker cap — ${bumped[0].poster_name || 'someone'}'s oldest sticker rotated off`);
        }
      }

      const rows = await sql`
        INSERT INTO stickies (message, detail, color, author, sticker_url, poster_name, board_no, link_url)
        VALUES (${message}, ${detail}, ${color}, ${who.label}, ${sticker_url}, ${poster_name}, ${boardNo}, ${link_url})
        RETURNING id`;
      await logChange(who, 'board', sticker_url
        ? `${poster_name} pinned a sticker on board ${boardNo}`
        : link_url
          ? `${poster_name} pinned a link on board ${boardNo}: “${message.slice(0, 40)}”`
          : `${poster_name} pinned a note on board ${boardNo}: “${message.slice(0, 40)}”`);
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

    if (op === 'unreact') {
      // Remove `count` of a matching reaction from a note — NEWEST first,
      // since the mistaken click is almost always the latest one.
      const sticky_id = Number(b.sticky_id);
      const emoji = (b.emoji || '').toString().trim().slice(0, 8);
      const sticker_url = (b.sticker_url || '').toString().trim();
      const count = Math.max(1, Math.min(50, Math.round(Number(b.count)) || 1));
      if (!Number.isInteger(sticky_id) || sticky_id <= 0) return res.status(400).json({ error: 'Bad sticky_id' });
      if (!emoji && !sticker_url) return res.status(400).json({ error: 'Say which reaction to remove' });
      const gone = await sql`
        UPDATE sticky_reactions SET active = false
        WHERE id IN (
          SELECT id FROM sticky_reactions
          WHERE active = true AND sticky_id = ${sticky_id}
            AND emoji = ${emoji} AND sticker_url = ${sticker_url}
          ORDER BY id DESC LIMIT ${count}
        ) RETURNING id`;
      return res.status(200).json({ ok: true, removed: gone.length });
    }

    if (op === 'tie') {
      const from_id = Number(b.from_id), to_id = Number(b.to_id);
      const color = YARN_COLORS.includes(b.color) ? b.color : YARN_COLORS[0];
      if (!Number.isInteger(from_id) || !Number.isInteger(to_id) || from_id <= 0 || to_id <= 0) {
        return res.status(400).json({ error: 'Bad ids' });
      }
      if (from_id === to_id) return res.status(400).json({ error: 'Yarn needs two different items' });
      const ends = await sql`
        SELECT id FROM stickies
        WHERE active = true AND board_no = ${boardNo} AND id IN (${from_id}, ${to_id})
          AND (sticker_url = '' OR created_at > now() - interval '24 hours')`;
      if (ends.length !== 2) return res.status(404).json({ error: 'Both ends must be on this board' });
      const dup = await sql`
        SELECT id FROM sticky_yarn
        WHERE active = true AND board_no = ${boardNo}
          AND ((from_id = ${from_id} AND to_id = ${to_id}) OR (from_id = ${to_id} AND to_id = ${from_id}))
        LIMIT 1`;
      if (dup.length) return res.status(409).json({ error: 'Those two are already tied' });
      const rows = await sql`
        INSERT INTO sticky_yarn (from_id, to_id, color, board_no)
        VALUES (${from_id}, ${to_id}, ${color}, ${boardNo}) RETURNING id`;
      await logChange(who, 'board', `Tied ${color} yarn between two items on board ${boardNo}`);
      return res.status(200).json({ ok: true, id: rows[0].id, color });
    }

    if (op === 'yarn_color') {
      const id = Number(b.id);
      const color = YARN_COLORS.includes(b.color) ? b.color : null;
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      if (!color) return res.status(400).json({ error: 'Bad color', colors: YARN_COLORS });
      const rows = await sql`UPDATE sticky_yarn SET color = ${color} WHERE id = ${id} AND active = true RETURNING id`;
      if (!rows.length) return res.status(404).json({ error: 'No such yarn', id });
      return res.status(200).json({ ok: true, id, color });
    }

    if (op === 'cut') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rows = await sql`UPDATE sticky_yarn SET active = false WHERE id = ${id} AND active = true RETURNING board_no`;
      if (!rows.length) return res.status(404).json({ error: 'No such yarn', id });
      await logChange(who, 'board', `Cut a yarn on board ${rows[0].board_no}`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'delete') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rows = await sql`UPDATE stickies SET active = false WHERE id = ${id} RETURNING message, author, poster_name, sticker_url`;
      if (!rows.length) return res.status(404).json({ error: 'No such note', id });
      await logChange(who, 'board', rows[0].sticker_url
        ? `Took down ${rows[0].poster_name || rows[0].author}'s sticker`
        : `Took down ${rows[0].poster_name || rows[0].author}'s note: “${String(rows[0].message).slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'save', 'transform', 'react', 'unreact', 'tie', 'yarn_color', 'cut', 'delete'] });
  } catch (err) {
    res.status(500).json({ error: 'Board operation failed — has Setup been run?', detail: String(err) });
  }
}
