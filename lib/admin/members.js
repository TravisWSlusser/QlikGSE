import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/members — the team member registry and project tagging.

  Members are real people, optionally linked to their REC Room trigram
  (the same self-declared identity the arcade uses). Tagging a member
  onto a project is what builds their history — the Board's person card
  reads it straight out of projects {op:'list'} (which bundles members +
  tags), so there is no read op here. Phase 2 hangs self-set access
  codes off this registry: a member must exist (be "tagged in") before
  they can claim one, and credentials will be stored hashed, never as
  plaintext.

  { op:'save', id?, name, trigram?, team_id?, title? }
  { op:'retire', id, restore? }        soft — tags stay for history
  { op:'tag', project_id, member_id }
  { op:'untag', project_id, member_id }

  All ops need the 'projects' scope; the registry travels to every key
  holder inside projects {op:'list'}.
*/

const TRIGRAM = /^[A-Za-z]{3}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'projects');
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'save') {
      const id = Number(b.id) || 0;
      const name = String(b.name || '').trim().slice(0, 60);
      const trigram = String(b.trigram || '').trim().toUpperCase();
      const title = String(b.title || '').trim().slice(0, 60);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
      const team_id = Number(b.team_id) || null;
      if (name.length < 2) return res.status(400).json({ error: 'The member needs a name' });
      if (trigram && !TRIGRAM.test(trigram)) return res.status(400).json({ error: 'Trigrams are three letters (like the REC Room)' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email does not look like one' });
      if (trigram) {
        const dup = await sql`SELECT id FROM team_members
          WHERE active = true AND trigram = ${trigram} AND id <> ${id} LIMIT 1`;
        if (dup.length) return res.status(409).json({ error: `${trigram} already belongs to another member` });
      }
      let mid = id;
      if (id) {
        const rows = await sql`UPDATE team_members SET name = ${name}, trigram = ${trigram},
          title = ${title}, team_id = ${team_id}, email = ${email} WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      } else {
        const rows = await sql`INSERT INTO team_members (name, trigram, title, team_id, email, created_by)
          VALUES (${name}, ${trigram}, ${title}, ${team_id}, ${email}, ${who.label}) RETURNING id`;
        mid = rows[0].id;
      }
      await logChange(who, 'projects', `${id ? 'Updated' : 'Added'} team member ${name}${trigram ? ` (${trigram})` : ''}`);
      return res.status(200).json({ ok: true, id: mid });
    }

    if (op === 'retire') {
      const id = Number(b.id);
      const restore = !!b.restore;
      const rows = await sql`UPDATE team_members SET active = ${restore} WHERE id = ${id} RETURNING name`;
      if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      await logChange(who, 'projects', `${restore ? 'Restored' : 'Retired'} team member ${rows[0].name}`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'resetCode') {
      const id = Number(b.id);
      const rows = await sql`UPDATE team_members
        SET code_hash = '', code_salt = '', claimed_at = NULL
        WHERE id = ${id} RETURNING name`;
      if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      await logChange(who, 'projects', `Reset ${rows[0].name}'s member access code`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'tag') {
      const project_id = Number(b.project_id), member_id = Number(b.member_id);
      const p = await sql`SELECT id, title FROM projects WHERE id = ${project_id} AND active = true LIMIT 1`;
      if (!p.length) return res.status(404).json({ error: 'No such project', id: project_id });
      const m = await sql`SELECT id, name FROM team_members WHERE id = ${member_id} AND active = true LIMIT 1`;
      if (!m.length) return res.status(404).json({ error: 'No such member', id: member_id });
      const dup = await sql`SELECT id FROM project_members
        WHERE active = true AND project_id = ${project_id} AND member_id = ${member_id} LIMIT 1`;
      if (dup.length) return res.status(409).json({ error: `${m[0].name} is already on this project` });
      await sql`INSERT INTO project_members (project_id, member_id, created_by)
        VALUES (${project_id}, ${member_id}, ${who.label})`;
      await sql`INSERT INTO project_log (project_id, kind, note, actor)
        VALUES (${project_id}, 'update', ${`Tagged ${m[0].name} onto the project`}, ${who.label})`;
      await logChange(who, 'projects', `Tagged ${m[0].name} on “${p[0].title.slice(0, 40)}”`);
      return res.status(200).json({ ok: true });
    }

    if (op === 'untag') {
      const project_id = Number(b.project_id), member_id = Number(b.member_id);
      const m = await sql`SELECT name FROM team_members WHERE id = ${member_id} LIMIT 1`;
      const rows = await sql`UPDATE project_members SET active = false
        WHERE active = true AND project_id = ${project_id} AND member_id = ${member_id} RETURNING id`;
      if (!rows.length) return res.status(404).json({ error: 'That tag is not there' });
      const name = m.length ? m[0].name : 'someone';
      await sql`INSERT INTO project_log (project_id, kind, note, actor)
        VALUES (${project_id}, 'update', ${`Untagged ${name} from the project`}, ${who.label})`;
      await logChange(who, 'projects', `Untagged ${name} from a project`);
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: 'Bad op', ops: ['save', 'retire', 'resetCode', 'tag', 'untag'] });
  } catch (err) {
    res.status(500).json({ error: 'Member operation failed — has Setup been run?', detail: String(err) });
  }
}
