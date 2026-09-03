import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/projects — the Sales Enablement project tracker.

  The product is visibility with teeth: every project belongs to a team,
  sits in a status (both managed lists — projectsAdmin.js), and carries
  phase_due — the date its current phase was PROMISED to be done. The
  moment a status changes, a new promise is declared. When a promise
  slips past its date the project is OVERDUE, and the next status change
  (or an 'extend') must carry a written explanation. Everything lands in
  project_log — the APPEND-ONLY diary management reads by quarter.

  Reads are open to any valid key (visibility is the point); writes need
  the 'projects' scope. Overdue is COMPUTED here, never stored — there is
  no cron in this stack to flip a flag at midnight, and one predicate
  shared by list and the write gate cannot disagree with itself.

  { op:'list', all? }                    → projects+teams+statuses+milestones+today
  { op:'save', id?, title, description, people, team_id, links,
    status_id?, phase_due? }             (status/due only on CREATE — after
                                          that they move via status/extend)
  { op:'status', id, status_id, phase_due, note? }   THE accountability gate
  { op:'extend', id, phase_due, note? }  move the promise; overdue ⇒ note required
  { op:'note', id, note }                free diary entry
  { op:'retire', id, restore? }
  { op:'saveMilestone', id?, project_id, date, title, detail? }
  { op:'deleteMilestone', id }
  { op:'log', project_id }               one project's diary, oldest first
  { op:'review', from, to }              the quarter view: every entry in range
*/

const MAX_TITLE = 90, MAX_DESC = 2000, MAX_PEOPLE = 300, MAX_NOTE = 1000, MIN_NOTE = 10, MAX_LINKS = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Dates are date-only ISO strings compared LEXICALLY — never new Date(iso),
// which parses UTC and shifts a day west of Greenwich (the repo's oldest
// trap). "Today" is anchored to America/New_York so every viewer's board
// agrees on who is overdue. The due day itself is NOT overdue; the morning
// after is.
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function validDate(s) {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const dateStr = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

function cleanLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_LINKS)
    .map(l => ({ label: String((l && l.label) || '').trim().slice(0, 40), href: String((l && l.href) || '').trim().slice(0, 500) }))
    .filter(l => l.href && /^https?:\/\/\S+$/i.test(l.href))
    .map(l => ({ label: l.label || l.href.replace(/^https?:\/\//i, '').slice(0, 40), href: l.href }));
}

async function getProject(id) {
  const rows = await sql`SELECT * FROM projects WHERE id = ${id} LIMIT 1`;
  return rows.length ? rows[0] : null;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = parseBody(req);
  const op = (b.op || '').toString();
  const READ_OPS = ['list', 'log', 'review'];
  // Member sessions (auth.js, `TRI:code`) may run these — but only on
  // projects they are TAGGED on; memberCan() below is that gate. Every
  // other write stays projects-scope-only.
  const MEMBER_OPS = ['status', 'extend', 'note', 'saveMilestone', 'deleteMilestone'];
  const who = await requireScope(req, res,
    READ_OPS.includes(op) || MEMBER_OPS.includes(op) ? null : 'projects');
  if (!who) return;
  const fullEdit = who.scopes.includes('projects');
  const MEMBER_DENY = 'This needs the projects scope — or being tagged on this project as a team member';
  const memberCan = async projectId => {
    if (fullEdit) return true;
    if (!who.member) return false;
    try {
      const t = await sql`SELECT id FROM project_members
        WHERE active = true AND project_id = ${projectId} AND member_id = ${who.member.id} LIMIT 1`;
      return t.length > 0;
    } catch { return false; }
  };

  try {
    if (op === 'list') {
      const today = todayIso();
      const projects = (b.all
        ? await sql`SELECT * FROM projects ORDER BY id DESC`
        : await sql`SELECT * FROM projects WHERE active = true ORDER BY id DESC`
      ).map(p => {
        const due = dateStr(p.phase_due);
        const setAt = new Date(p.phase_set_at).getTime();
        return {
          ...p, phase_due: due,
          overdue: p.active && due < today,
          days_in_phase: Math.max(0, Math.round((Date.now() - setAt) / 86400000)),
        };
      });
      // overdue first, then the soonest promise, then newest
      projects.sort((a, z) => (z.overdue - a.overdue) || (a.phase_due < z.phase_due ? -1 : a.phase_due > z.phase_due ? 1 : z.id - a.id));
      // SELECT * on purpose: leader_id arrives with a Setup re-run, and
      // naming it here would break the whole board for the gap between
      // deploy and migration — absent columns just come back undefined
      const teams = await sql`SELECT * FROM project_teams ORDER BY sort, id`;
      const statuses = await sql`SELECT id, label, color, sort, active FROM project_statuses ORDER BY sort, id`;
      const milestones = (await sql`
        SELECT m.id, m.project_id, m.date, m.title, m.detail
        FROM project_milestones m JOIN projects p ON p.id = m.project_id
        WHERE m.active = true AND p.active = true ORDER BY m.date, m.id`)
        .map(m => ({ ...m, date: dateStr(m.date) }));
      // the member registry + tags ride along so the Board renders people
      // chips and person-history cards from one call; sub-wrapped so a
      // pre-Setup database (registry tables not yet created) still serves
      let members = [], tags = [], recs = [];
      try {
        try {
          members = await sql`SELECT id, name, trigram, team_id, title, email, active,
            is_leader, is_manager, manager_id, avatar_url, ooo_note,
            (code_hash <> '') AS claimed FROM team_members ORDER BY name`;
        } catch {
          try {
            // pre-v6: profile columns not there yet
            members = await sql`SELECT id, name, trigram, team_id, title, email, active,
              is_leader, is_manager, manager_id, (code_hash <> '') AS claimed FROM team_members ORDER BY name`;
          } catch {
            // pre-v3: is_manager not there yet — the list must not 500
            members = await sql`SELECT id, name, trigram, team_id, title, email, active,
              is_leader, manager_id, (code_hash <> '') AS claimed FROM team_members ORDER BY name`;
          }
        }
        tags = await sql`SELECT project_id, member_id FROM project_members WHERE active = true`;
      } catch { /* re-run Setup for the registry */ }
      // REC Room performance rides along for the staff profiles — sub-wrapped:
      // an arcade table problem must never take the Board down
      try {
        recs = await sql`SELECT trigram, total_score, games_played, blitz_personal_high,
          attempted, correct, last_seen FROM players`;
      } catch { /* no arcade data — profiles just skip the section */ }
      return res.status(200).json({ projects, teams, statuses, milestones, members, tags, recs, today });
    }

    if (op === 'save') {
      const id = Number(b.id) || 0;
      const title = String(b.title || '').trim();
      const description = String(b.description || '').trim();
      const people = String(b.people || '').trim();
      const team_id = Number(b.team_id);
      const links = cleanLinks(b.links);
      if (!title) return res.status(400).json({ error: 'The project needs a title' });
      if (title.length > MAX_TITLE) return res.status(400).json({ error: `Title is ${title.length}/${MAX_TITLE} characters` });
      if (description.length > MAX_DESC) return res.status(400).json({ error: `Description is ${description.length}/${MAX_DESC} characters` });
      if (people.length > MAX_PEOPLE) return res.status(400).json({ error: `People list is ${people.length}/${MAX_PEOPLE} characters` });
      const team = await sql`SELECT id FROM project_teams WHERE id = ${team_id} AND active = true LIMIT 1`;
      if (!team.length) return res.status(400).json({ error: 'Pick a team' });

      if (id) {
        // status and phase_due deliberately untouchable here — accountability
        // moves only through 'status' and 'extend', which write the diary
        const cur = await getProject(id);
        if (!cur) return res.status(404).json({ error: 'No such project', id });
        const changed = [];
        if (cur.title !== title) changed.push('title');
        if (cur.description !== description) changed.push('description');
        if (cur.people !== people) changed.push('people');
        if (cur.team_id !== team_id) changed.push('team');
        if (JSON.stringify(cur.links) !== JSON.stringify(links)) changed.push('links');
        await sql`UPDATE projects SET title = ${title}, description = ${description},
          people = ${people}, team_id = ${team_id}, links = ${JSON.stringify(links)}::jsonb,
          updated_at = now() WHERE id = ${id}`;
        if (changed.length) {
          await sql`INSERT INTO project_log (project_id, kind, note, actor)
            VALUES (${id}, 'update', ${'Edited: ' + changed.join(', ')}, ${who.label})`;
        }
        await logChange(who, 'projects', `Updated project “${title.slice(0, 40)}”`);
        return res.status(200).json({ ok: true, id });
      }

      // create: the first promise is part of birth
      const status_id = Number(b.status_id);
      const phase_due = String(b.phase_due || '').trim();
      const st = await sql`SELECT id FROM project_statuses WHERE id = ${status_id} AND active = true LIMIT 1`;
      if (!st.length) return res.status(400).json({ error: 'Pick a starting status' });
      if (!validDate(phase_due)) return res.status(400).json({ error: 'Declare when this phase will be done (YYYY-MM-DD)' });
      if (phase_due < todayIso()) return res.status(400).json({ error: 'The phase date has to be today or later' });
      const rows = await sql`INSERT INTO projects
        (title, description, people, team_id, status_id, links, phase_due, phase_set_by, created_by)
        VALUES (${title}, ${description}, ${people}, ${team_id}, ${status_id},
                ${JSON.stringify(links)}::jsonb, ${phase_due}, ${who.label}, ${who.label})
        RETURNING id`;
      await sql`INSERT INTO project_log (project_id, kind, to_status_id, phase_due, actor)
        VALUES (${rows[0].id}, 'created', ${status_id}, ${phase_due}, ${who.label})`;
      await logChange(who, 'projects', `Posted project “${title.slice(0, 40)}” (due ${phase_due})`);
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'status') {
      const id = Number(b.id);
      const status_id = Number(b.status_id);
      const phase_due = String(b.phase_due || '').trim();
      const note = String(b.note || '').trim().slice(0, MAX_NOTE);
      const p = await getProject(id);
      if (!p || !p.active) return res.status(404).json({ error: 'No such project', id });
      if (!(await memberCan(id))) return res.status(403).json({ error: MEMBER_DENY });
      if (status_id === p.status_id) return res.status(409).json({ error: 'Already in that status' });
      const st = await sql`SELECT label FROM project_statuses WHERE id = ${status_id} AND active = true LIMIT 1`;
      if (!st.length) return res.status(400).json({ error: 'Pick a status' });
      if (!validDate(phase_due)) return res.status(400).json({ error: 'Declare when this phase will be done (YYYY-MM-DD)' });
      if (phase_due < todayIso()) return res.status(400).json({ error: 'The phase date has to be today or later' });
      // THE GATE: a promise that slipped must be answered for, in writing,
      // before the board lets the project move on.
      if (dateStr(p.phase_due) < todayIso() && note.length < MIN_NOTE) {
        return res.status(409).json({
          error: `This project went overdue on ${dateStr(p.phase_due)}. Say what happened (${MIN_NOTE}+ characters) with the status change.`,
          overdue: true,
        });
      }
      await sql`UPDATE projects SET status_id = ${status_id}, phase_due = ${phase_due},
        phase_set_at = now(), phase_set_by = ${who.label}, updated_at = now() WHERE id = ${id}`;
      await sql`INSERT INTO project_log (project_id, kind, note, from_status_id, to_status_id, phase_due, actor)
        VALUES (${id}, 'status_change', ${note}, ${p.status_id}, ${status_id}, ${phase_due}, ${who.label})`;
      await logChange(who, 'projects', `“${p.title.slice(0, 40)}” → ${st[0].label} (due ${phase_due})`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'extend') {
      const id = Number(b.id);
      const phase_due = String(b.phase_due || '').trim();
      const note = String(b.note || '').trim().slice(0, MAX_NOTE);
      const p = await getProject(id);
      if (!p || !p.active) return res.status(404).json({ error: 'No such project', id });
      if (!(await memberCan(id))) return res.status(403).json({ error: MEMBER_DENY });
      if (!validDate(phase_due)) return res.status(400).json({ error: 'Pick the new date (YYYY-MM-DD)' });
      if (phase_due < todayIso()) return res.status(400).json({ error: 'The new date has to be today or later' });
      const wasOverdue = dateStr(p.phase_due) < todayIso();
      if (wasOverdue && note.length < MIN_NOTE) {
        return res.status(409).json({
          error: `This project went overdue on ${dateStr(p.phase_due)}. The written log (${MIN_NOTE}+ characters) is the price of the extension.`,
          overdue: true,
        });
      }
      await sql`UPDATE projects SET phase_due = ${phase_due}, updated_at = now() WHERE id = ${id}`;
      await sql`INSERT INTO project_log (project_id, kind, note, phase_due, actor)
        VALUES (${id}, ${wasOverdue ? 'overdue_note' : 'due_change'}, ${note}, ${phase_due}, ${who.label})`;
      await logChange(who, 'projects', wasOverdue
        ? `Filed what happened on “${p.title.slice(0, 40)}”, new date ${phase_due}`
        : `Moved “${p.title.slice(0, 40)}” phase date to ${phase_due}`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'note') {
      const id = Number(b.id);
      const note = String(b.note || '').trim().slice(0, MAX_NOTE);
      if (!note) return res.status(400).json({ error: 'The update needs words' });
      const p = await getProject(id);
      if (!p || !p.active) return res.status(404).json({ error: 'No such project', id });
      if (!(await memberCan(id))) return res.status(403).json({ error: MEMBER_DENY });
      await sql`INSERT INTO project_log (project_id, kind, note, actor)
        VALUES (${id}, 'update', ${note}, ${who.label})`;
      return res.status(200).json({ ok: true });
    }

    if (op === 'retire') {
      const id = Number(b.id);
      const restore = !!b.restore;
      const p = await getProject(id);
      if (!p) return res.status(404).json({ error: 'No such project', id });
      await sql`UPDATE projects SET active = ${restore}, updated_at = now() WHERE id = ${id}`;
      await sql`INSERT INTO project_log (project_id, kind, note, actor)
        VALUES (${id}, 'update', ${restore ? 'Restored to the board' : 'Retired from the board'}, ${who.label})`;
      await logChange(who, 'projects', `${restore ? 'Restored' : 'Retired'} project “${p.title.slice(0, 40)}”`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'saveMilestone') {
      const id = Number(b.id) || 0;
      const project_id = Number(b.project_id);
      const date = String(b.date || '').trim();
      const title = String(b.title || '').trim().slice(0, 80);
      const detail = String(b.detail || '').trim().slice(0, 500);
      // past dates ALLOWED — recording the demo that already happened is legitimate
      if (!validDate(date)) return res.status(400).json({ error: 'Milestones need a real date (YYYY-MM-DD)' });
      if (!title) return res.status(400).json({ error: 'The milestone needs a title' });
      const p = await getProject(project_id);
      if (!p || !p.active) return res.status(404).json({ error: 'No such project', id: project_id });
      if (!(await memberCan(project_id))) return res.status(403).json({ error: MEMBER_DENY });
      let mid = id;
      if (id) {
        const rows = await sql`UPDATE project_milestones SET date = ${date}, title = ${title},
          detail = ${detail} WHERE id = ${id} AND active = true RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such milestone', id });
      } else {
        const rows = await sql`INSERT INTO project_milestones (project_id, date, title, detail, created_by)
          VALUES (${project_id}, ${date}, ${title}, ${detail}, ${who.label}) RETURNING id`;
        mid = rows[0].id;
        await sql`INSERT INTO project_log (project_id, kind, note, phase_due, actor)
          VALUES (${project_id}, 'milestone', ${title}, ${date}, ${who.label})`;
      }
      await logChange(who, 'projects', `Milestone on “${p.title.slice(0, 40)}”: ${title} (${date})`);
      return res.status(200).json({ ok: true, id: mid });
    }

    if (op === 'deleteMilestone') {
      const id = Number(b.id);
      const mrows = await sql`SELECT project_id FROM project_milestones WHERE id = ${id} AND active = true LIMIT 1`;
      if (!mrows.length) return res.status(404).json({ error: 'No such milestone', id });
      if (!(await memberCan(mrows[0].project_id))) return res.status(403).json({ error: MEMBER_DENY });
      await sql`UPDATE project_milestones SET active = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'log') {
      const project_id = Number(b.project_id);
      const entries = (await sql`
        SELECT id, kind, note, from_status_id, to_status_id, phase_due, actor, created_at
        FROM project_log WHERE project_id = ${project_id} ORDER BY id ASC LIMIT 500`)
        .map(e => ({ ...e, phase_due: e.phase_due ? dateStr(e.phase_due) : null }));
      return res.status(200).json({ entries });
    }

    if (op === 'review') {
      const from = String(b.from || '').trim(), to = String(b.to || '').trim();
      if (!validDate(from) || !validDate(to) || from > to) {
        return res.status(400).json({ error: 'Give the range as two dates, from <= to' });
      }
      const [fy, fm, fd] = from.split('-').map(Number);
      const [ty, tm, td] = to.split('-').map(Number);
      if ((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000 > 370) {
        return res.status(400).json({ error: 'A review range tops out at a year' });
      }
      // range is [from 00:00, day-after-to 00:00) in the board's timezone
      const entries = (await sql`
        SELECT id, project_id, kind, note, from_status_id, to_status_id, phase_due, actor, created_at
        FROM project_log
        WHERE created_at >= (${from}::date::timestamp AT TIME ZONE 'America/New_York')
          AND created_at <  ((${to}::date + 1)::timestamp AT TIME ZONE 'America/New_York')
        ORDER BY project_id, id ASC LIMIT 2000`)
        .map(e => ({ ...e, phase_due: e.phase_due ? dateStr(e.phase_due) : null }));
      const ids = [...new Set(entries.map(e => e.project_id))];
      const projects = ids.length
        ? await sql`SELECT id, title, team_id, active FROM projects WHERE id = ANY(${ids}::int[]) ORDER BY id`
        : [];
      return res.status(200).json({ projects, entries });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'save', 'status', 'extend', 'note', 'retire', 'saveMilestone', 'deleteMilestone', 'log', 'review'] });
  } catch (err) {
    res.status(500).json({ error: 'Project operation failed — has Setup been run?', detail: String(err) });
  }
}
