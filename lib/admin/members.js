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
  const b = parseBody(req);
  const op = (b.op || '').toString();
  // self-service ops a plain member session may run: their own OOO, their
  // own status post, and reacting to anyone's status
  const SELF_OPS = ['ooo', 'status', 'statusReact'];
  const who = await requireScope(req, res, SELF_OPS.includes(op) ? null : 'projects');
  if (!who) return;

  if (['save', 'retire', 'resetCode', 'invite'].includes(op) && !who.master && !who.manager) {
    return res.status(403).json({ error: 'Only managers sign the team up, invite, reset codes, or edit members' });
  }
  // logins are tighter still: activation keys and resets belong to the
  // people leaders (Travis: "that way folks don't mess with logins")
  if (['invite', 'resetCode'].includes(op) && !who.master && !(who.manager && who.people_leader)) {
    return res.status(403).json({ error: 'Only people leaders issue activation keys or reset codes' });
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
      const avatar_url = String(b.avatar_url || '').trim().slice(0, 500);
      if (avatar_url && !/^https?:\/\/\S+$/i.test(avatar_url)) {
        return res.status(400).json({ error: 'Avatars need a working http(s) image URL' });
      }
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
          is_leader = ${is_leader}, is_manager = ${is_manager}, manager_id = ${manager_id},
          avatar_url = ${avatar_url}
          WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such member', id });
        // stepping down as a leader releases their reports' lines
        if (!is_leader) {
          await sql`UPDATE team_members SET manager_id = NULL WHERE manager_id = ${id}`;
        }
      } else {
        const rows = await sql`INSERT INTO team_members (name, trigram, title, team_id, email, is_leader, is_manager, manager_id, avatar_url, created_by)
          VALUES (${name}, ${trigram}, ${title}, ${team_id}, ${email}, ${is_leader}, ${is_manager}, ${manager_id}, ${avatar_url}, ${who.label}) RETURNING id`;
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

    if (op === 'ooo') {
      // Out-of-office: yours to set (a member on their own row), or a
      // manager's/master's on anyone. Empty clears it.
      const id = Number(b.id);
      const note = String(b.note || '').trim().slice(0, 140);
      const self = who.member && who.member.id === id;
      if (!self && !who.master && !who.manager) {
        return res.status(403).json({ error: 'You can set your own out-of-office; managers can set anyone’s' });
      }
      const rows = await sql`UPDATE team_members SET ooo_note = ${note}
        WHERE id = ${id} AND active = true RETURNING name`;
      if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      await logChange(who, 'projects', note
        ? `Set ${self ? 'their' : `${rows[0].name}'s`} out-of-office: ${note.slice(0, 60)}`
        : `Cleared ${self ? 'their' : `${rows[0].name}'s`} out-of-office`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'status') {
      // The informal post — a quote, a joke. Yours to set on your own row
      // (managers can clear anyone's). Editing or deleting it wipes the
      // reactions too: the old post is gone FOREVER, by design.
      const id = Number(b.id);
      const text = String(b.text || '').trim().slice(0, 180);
      const self = who.member && who.member.id === id;
      if (!self && !who.master && !who.manager) {
        return res.status(403).json({ error: 'You can post your own status; managers can clear anyone’s' });
      }
      const rows = text
        ? await sql`UPDATE team_members SET status_text = ${text}, status_at = now()
            WHERE id = ${id} AND active = true RETURNING name`
        : await sql`UPDATE team_members SET status_text = '', status_at = NULL
            WHERE id = ${id} AND active = true RETURNING name`;
      if (!rows.length) return res.status(404).json({ error: 'No such member', id });
      try { await sql`DELETE FROM staff_status_reactions WHERE member_id = ${id}`; } catch {}
      await logChange(who, 'projects', text
        ? `${self ? who.label : rows[0].name} posted a status`
        : `Cleared ${self ? 'their' : `${rows[0].name}'s`} status`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'statusReact') {
      const id = Number(b.id);
      const emoji = String(b.emoji || '').trim().slice(0, 8);
      if (!emoji) return res.status(400).json({ error: 'Pick an emoji' });
      const t = await sql`SELECT id, status_text FROM team_members WHERE id = ${id} AND active = true LIMIT 1`;
      if (!t.length || !t[0].status_text) return res.status(409).json({ error: 'That post is gone' });
      const reactor = (who.member && who.member.name) || who.label;
      await sql`INSERT INTO staff_status_reactions (member_id, emoji, name)
        VALUES (${id}, ${emoji}, ${reactor})`;
      return res.status(200).json({ ok: true });
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

    res.status(400).json({ error: 'Bad op', ops: ['save', 'retire', 'resetCode', 'invite', 'ooo', 'status', 'statusReact', 'tag', 'untag'] });
  } catch (err) {
    res.status(500).json({ error: 'Member operation failed — has Setup been run?', detail: String(err) });
  }
}
