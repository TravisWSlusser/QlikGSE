import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/trophies — a project's Trophy Case.

  Travis: "allows folks who are assigned to the projects to post things
  or highlights they are proud of. Maybe a screenshot of a project, maybe
  a review from a coworker."

  Deliberately SEPARATE from the diary. The diary is the record — status
  moves, date changes, overdue explanations — and it is written mostly by
  the system. This is the highlight reel, written only by people. Mixing
  them would bury the wins in the audit trail, and the audit trail is not
  what anyone wants to read when they are asked what the team has done.

  Four kinds, because a win comes in four shapes:
    win      something landed
    praise   what somebody else said about it
    shot     a screenshot (image_url, our Blob only)
    link     a deck, a doc, a recording

  { op:'list', project_id }   any valid key — the case is as public as the board
  { op:'add', project_id, kind, message?, image_url?, link_url? }
      Members TAGGED ON THAT PROJECT, plus managers. Not the whole org:
      a trophy case anyone can fill is a noticeboard, and the point is
      that it belongs to the people who did the work.
  { op:'remove', id }         yours, or a manager's
*/
const KINDS = ['win', 'praise', 'shot', 'link'];
const HTTP = /^https?:\/\/\S+$/i;
const BLOB = /^https:\/\/[\w.-]+\.(?:public\.)?blob\.vercel-storage\.com\/\S+$/i;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = parseBody(req);
  const op = (b.op || '').toString();
  const who = await requireScope(req, res, null);
  if (!who) return;

  const me = (who.member && who.member.id) || 0;
  const manager = !!(who.master || who.manager);

  try {
    if (op === 'list') {
      const pid = Number(b.project_id);
      if (!pid) return res.status(400).json({ error: 'project_id required' });
      const rows = await sql`
        SELECT t.id, t.project_id, t.member_id, t.author_name, t.kind, t.message,
               t.image_url, t.link_url, t.created_at,
               m.name, m.title, m.avatar_url
        FROM project_trophies t
        LEFT JOIN team_members m ON m.id = t.member_id
        WHERE t.project_id = ${pid} AND t.active = true
        ORDER BY t.id DESC LIMIT 60`;
      return res.status(200).json({ ok: true, trophies: rows });
    }

    if (op === 'add') {
      if (!me) return res.status(403).json({ error: 'Only staff members post to a trophy case' });
      const pid = Number(b.project_id);
      if (!pid) return res.status(400).json({ error: 'project_id required' });

      // tagged on it, or a manager. The people who did the work own the case.
      if (!manager) {
        const tag = await sql`SELECT 1 FROM project_members
          WHERE project_id = ${pid} AND member_id = ${me} AND active = true LIMIT 1`;
        if (!tag.length) {
          return res.status(403).json({ error: 'Post to a project you are tagged on — ask to be added first' });
        }
      }

      const kind = KINDS.includes(b.kind) ? b.kind : 'win';
      const message = String(b.message || '').trim().slice(0, 600);
      const image = String(b.image_url || '').trim().slice(0, 500);
      const link = String(b.link_url || '').trim().slice(0, 500);

      // An image has to come from OUR uploader. Accepting any URL would
      // put an arbitrary remote image on a page the whole org loads.
      if (kind === 'shot' && !BLOB.test(image)) {
        return res.status(400).json({ error: 'Upload the screenshot here rather than linking one' });
      }
      if (kind === 'link' && !HTTP.test(link)) {
        return res.status(400).json({ error: 'A link needs to start with http:// or https://' });
      }
      if (kind !== 'shot' && !message) return res.status(400).json({ error: 'Say what it is' });

      const rows = await sql`
        INSERT INTO project_trophies
          (project_id, member_id, author_name, kind, message, image_url, link_url)
        VALUES (${pid}, ${me}, ${who.member.name}, ${kind}, ${message},
                ${kind === 'shot' ? image : ''}, ${kind === 'link' ? link : ''})
        RETURNING id`;
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'remove') {
      const id = Number(b.id);
      const r = await sql`SELECT member_id FROM project_trophies WHERE id = ${id} LIMIT 1`;
      if (!r.length) return res.status(404).json({ error: 'No such entry' });
      if (r[0].member_id !== me && !manager) {
        return res.status(403).json({ error: 'You can take down what you posted' });
      }
      await sql`UPDATE project_trophies SET active = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'add', 'remove'] });
  } catch (err) {
    res.status(500).json({ error: 'Trophy case failed — has Setup been run?', detail: String(err) });
  }
}
