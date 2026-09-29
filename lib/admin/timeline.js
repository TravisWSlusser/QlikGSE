import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/timeline — a person's own wall.

  The status line said one thing at a time and deleting it took its
  reactions with it. A timeline keeps what you posted. Three kinds,
  deliberately the same three the corkboard has, because people already
  know how those behave:

    text    message
    link    message (the title) + link_url, http/https only
    sticker sticker_url, from the GIPHY picker

  { op:'list', member_id }                    → posts + reactions
  { op:'post', kind, message?, link_url?, sticker_url? }
      ALWAYS on your OWN wall. There is no member_id on this op and that
      is the whole authorization model: you cannot post as someone else
      because the endpoint never reads who you say you are.
  { op:'remove', id }      yours, or a manager's call on anyone's
  { op:'react', id, emoji? | sticker_url? }   anyone, on anyone's post

  Reads are open to any valid key (the walls are as public as the Staff
  page). Writes need a MEMBER session — a scoped key is not a person and
  has no wall.
*/
const KINDS = ['text', 'link', 'sticker'];
const HTTP = /^https?:\/\/\S+$/i;
const GIPHY = /^https:\/\/(?:\w+\.)?giphy\.com\/\S+$/i;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = parseBody(req);
  const op = (b.op || '').toString();
  const who = await requireScope(req, res, null);
  if (!who) return;

  const me = who.member && who.member.id;
  const manager = !!(who.master || who.manager);

  try {
    if (op === 'list') {
      const id = Number(b.member_id);
      if (!id) return res.status(400).json({ error: 'member_id required' });
      const posts = await sql`
        SELECT id, member_id, kind, message, link_url, sticker_url, created_at
        FROM timeline_posts
        WHERE member_id = ${id} AND active = true
        ORDER BY id DESC LIMIT 60`;
      const reactions = posts.length
        ? await sql`SELECT post_id, emoji, sticker_url, name FROM timeline_reactions
            WHERE post_id = ANY(${posts.map(p => p.id)}::int[]) ORDER BY id`
        : [];
      return res.status(200).json({ ok: true, posts, reactions });
    }

    /* The feed behind the Home widget: the newest post from each person
       who has one, so the rotation shows a team and not one loud week. */
    if (op === 'feed') {
      const rows = await sql`
        SELECT DISTINCT ON (t.member_id)
               t.id, t.member_id, t.kind, t.message, t.link_url, t.sticker_url,
               t.created_at, m.name, m.trigram, m.title, m.avatar_url
        FROM timeline_posts t
        JOIN team_members m ON m.id = t.member_id
        WHERE t.active = true AND m.active = true
        ORDER BY t.member_id, t.id DESC`;
      rows.sort((a, z) => new Date(z.created_at) - new Date(a.created_at));
      return res.status(200).json({ ok: true, posts: rows.slice(0, 20) });
    }

    if (op === 'post') {
      if (!me) return res.status(403).json({ error: 'Only staff members have a wall — this key is not a person' });
      const kind = KINDS.includes(b.kind) ? b.kind : 'text';
      const message = String(b.message || '').trim().slice(0, 500);
      const link = String(b.link_url || '').trim().slice(0, 500);
      const sticker = String(b.sticker_url || '').trim().slice(0, 500);

      if (kind === 'text' && !message) return res.status(400).json({ error: 'Say something' });
      if (kind === 'link') {
        if (!HTTP.test(link)) return res.status(400).json({ error: 'A link needs to start with http:// or https://' });
        if (!message) return res.status(400).json({ error: 'Give the link a title' });
      }
      // Same rule as a status reaction: stickers come from OUR picker, so a
      // post can never become an arbitrary remote image embed.
      if (kind === 'sticker' && !GIPHY.test(sticker)) {
        return res.status(400).json({ error: 'Stickers come from the picker' });
      }

      const rows = await sql`
        INSERT INTO timeline_posts (member_id, kind, message, link_url, sticker_url)
        VALUES (${me}, ${kind}, ${message}, ${kind === 'link' ? link : ''},
                ${kind === 'sticker' ? sticker : ''})
        RETURNING id`;
      await logChange(who, 'projects', `${who.label} posted to their timeline`);
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'remove') {
      const id = Number(b.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const own = await sql`SELECT member_id FROM timeline_posts WHERE id = ${id} LIMIT 1`;
      if (!own.length) return res.status(404).json({ error: 'No such post' });
      if (own[0].member_id !== me && !manager) {
        return res.status(403).json({ error: 'You can take down your own posts' });
      }
      // Soft delete: the reactions stay attached to a row nobody serves,
      // which is the stickies rule and keeps a takedown reversible in SQL.
      await sql`UPDATE timeline_posts SET active = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (op === 'react') {
      const id = Number(b.id);
      const emoji = String(b.emoji || '').trim().slice(0, 8);
      const sticker = String(b.sticker_url || '').trim().slice(0, 500);
      if (!emoji && !sticker) return res.status(400).json({ error: 'Pick an emoji or a sticker' });
      if (sticker && !GIPHY.test(sticker)) return res.status(400).json({ error: 'Stickers come from the picker' });
      const live = await sql`SELECT id FROM timeline_posts WHERE id = ${id} AND active = true LIMIT 1`;
      if (!live.length) return res.status(409).json({ error: 'That post is gone' });
      const name = (who.member && who.member.name) || who.label;
      await sql`INSERT INTO timeline_reactions (post_id, emoji, sticker_url, name)
        VALUES (${id}, ${emoji}, ${sticker}, ${name})`;
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'feed', 'post', 'remove', 'react'] });
  } catch (err) {
    res.status(500).json({ error: 'Timeline failed — has Setup been run?', detail: String(err) });
  }
}
