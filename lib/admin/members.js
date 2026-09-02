import { sql, requireScope, cors, parseBody, makeSalt, hashCode } from './auth.js';
import { randomBytes } from 'node:crypto';
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
  holder inside projects {op:'list'}. The registry ops themselves —
  save, retire, resetCode — are tighter still: managers (is_manager)
  and master keys only. Travis: "These users will be the only ones able
  to assign new keys to users and are responsible for signing up their
  team." Tag/untag stays plain projects-scope — that is board work.
*/

const TRIGRAM = /^[A-Za-z]{3}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'projects');
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  if (['save', 'retire', 'resetCode', 'invite'].includes(op) && !who.master && !who.manager) {
    return res.status(403).json({ error: 'Only managers sign the team up, invite, reset codes, or edit members' });
  }

  try {
    if (op === 'save') {
      const id = Number(b.id) || 0;
      const name = String(b.name || '').trim().slice(0, 60);
      const trigram = String(b.trigram || '').trim().toUpperCase();
      const title = String(b.title || '').trim().slice(0, 60);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
      const team_id = Number(b.team_id) || null;
      const is_leader = !!b.is_leader;
      const is_manager = !!b.is_manager;
      // the reporting line: must point at an active, declared people leader
      // (there can be many), never at yourself
      let manager_id = Number(b.manager_id) || null;
      if (manager_id) {
        if (id && manager_id === id) return res.status(400).json({ error: 'Nobody reports to themself' });
        const mgr = await sql`SELECT id FROM team_members
          WHERE id = ${manager_id} AND active = true AND is_leader = true LIMIT 1`;
        if (!mgr.length) return res.status(400).json({ error: 'Reports-to has to be a declared people leader' });
      }
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
          title = ${title}, team_id = ${team_id}, email = ${email},
          is_leader = ${is_leader}, is_manager = ${is_manager}, manager_id = ${manager_id}
          WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such member', id });
        // stepping down as a leader releases their reports' lines
        if (!is_leader) {
          await sql`UPDATE team_members SET manager_id = NULL WHERE manager_id = ${id}`;
        }
      } else {
        const rows = await sql`INSERT INTO team_members (name, trigram, title, team_id, email, is_leader, is_manager, manager_id, created_by)
          VALUES (${name}, ${trigram}, ${title}, ${team_id}, ${email}, ${is_leader}, ${is_manager}, ${manager_id}, ${who.label}) RETURNING id`;
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

    if (op === 'invite') {
      // ONE-TIME invite code — the only way in (memberClaim requires it).
      // Returned in plaintext exactly once, to the manager who asked;
      // stored hashed, expires in 7 days, burned on use. The member's
      // EXISTING password keeps working until the invite is redeemed, so
      // an invite doubles as a safe password reset.
      const id = Number(b.id);
      const rows = await sql`SELECT id, name FROM team_members WHERE id = ${id} AND active = true LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — it gets read aloud
      const raw = Array.from(randomBytes(10)).map(x => ALPHA[x % ALPHA.length]).join('');
      const invite = raw.slice(0, 5) + '-' + raw.slice(5);
      const salt = makeSalt();
      const sender = (who.member && who.member.name) || who.label;
      await sql`UPDATE team_members
        SET invite_hash = ${hashCode(invite, salt)}, invite_salt = ${salt},
            invited_at = now(), invited_by = ${sender}
        WHERE id = ${id}`;
      await logChange(who, 'projects', `Issued a one-time invite for ${rows[0].name}`);
      return res.status(200).json({ ok: true, id, code: invite, name: rows[0].name });
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

    res.status(400).json({ error: 'Bad op', ops: ['save', 'retire', 'resetCode', 'invite', 'tag', 'untag'] });
  } catch (err) {
    res.status(500).json({ error: 'Member operation failed — has Setup been run?', detail: String(err) });
  }
}
