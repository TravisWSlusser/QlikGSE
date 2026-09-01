import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/projectsAdmin — the Projects tracker's managed lists.

  Teams and statuses are data, not code: rename, reorder, recolor, retire
  in the Board's managers. Retires are soft and REFUSED while any active
  project still holds the row — and the diary references status ids
  forever, which is why projects {op:'list'} returns retired rows too.

  { op:'saveTeam',     id?, name, sort? }
  { op:'retireTeam',   id }
  { op:'saveStatus',   id?, label, color, sort? }
  { op:'retireStatus', id }

  Reads come bundled in projects {op:'list'} — there is no list op here.
*/

// Mirrors the --ps-* tokens in CAPCOM/app.css — both themes validated with
// the dataviz six-checks script against the real card surfaces, in this
// adjacency order. No green: #009845 is the UI accent, never a data mark.
export const PALETTE = ['violet', 'teal', 'amber', 'rose', 'blue', 'orange', 'sky'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'projects');
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'saveTeam') {
      const id = Number(b.id) || 0;
      const name = String(b.name || '').trim().slice(0, 40);
      const sort = Math.round(Number(b.sort)) || 0;
      if (!name) return res.status(400).json({ error: 'The team needs a name' });
      const dup = await sql`SELECT id FROM project_teams
        WHERE active = true AND lower(name) = lower(${name}) AND id <> ${id} LIMIT 1`;
      if (dup.length) return res.status(409).json({ error: `There is already a team called “${name}”` });
      let tid = id;
      if (id) {
        const rows = await sql`UPDATE project_teams SET name = ${name}, sort = ${sort} WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such team', id });
      } else {
        const rows = await sql`INSERT INTO project_teams (name, sort, created_by)
          VALUES (${name}, ${sort}, ${who.label}) RETURNING id`;
        tid = rows[0].id;
      }
      await logChange(who, 'projects', `${id ? 'Updated' : 'Added'} team “${name}”`);
      return res.status(200).json({ ok: true, id: tid });
    }

    if (op === 'retireTeam') {
      const id = Number(b.id);
      const inUse = await sql`SELECT count(*)::int AS n FROM projects WHERE active = true AND team_id = ${id}`;
      if (inUse[0].n > 0) {
        return res.status(409).json({ error: `${inUse[0].n} active project${inUse[0].n > 1 ? 's are' : ' is'} on this team — move them first`, count: inUse[0].n });
      }
      const others = await sql`SELECT count(*)::int AS n FROM project_teams WHERE active = true AND id <> ${id}`;
      if (others[0].n === 0) return res.status(409).json({ error: 'The last team stays — the board needs at least one' });
      const rows = await sql`UPDATE project_teams SET active = false WHERE id = ${id} AND active = true RETURNING name`;
      if (!rows.length) return res.status(404).json({ error: 'No such team', id });
      await logChange(who, 'projects', `Retired team “${rows[0].name}”`);
      return res.status(200).json({ ok: true, id });
    }

    if (op === 'saveStatus') {
      const id = Number(b.id) || 0;
      const label = String(b.label || '').trim().slice(0, 30);
      const color = PALETTE.includes(b.color) ? b.color : PALETTE[0];
      const sort = Math.round(Number(b.sort)) || 0;
      if (!label) return res.status(400).json({ error: 'The status needs a label' });
      const dup = await sql`SELECT id FROM project_statuses
        WHERE active = true AND lower(label) = lower(${label}) AND id <> ${id} LIMIT 1`;
      if (dup.length) return res.status(409).json({ error: `There is already a status called “${label}”` });
      let sid = id;
      if (id) {
        const rows = await sql`UPDATE project_statuses SET label = ${label}, color = ${color}, sort = ${sort}
          WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such status', id });
      } else {
        const rows = await sql`INSERT INTO project_statuses (label, color, sort)
          VALUES (${label}, ${color}, ${sort}) RETURNING id`;
        sid = rows[0].id;
      }
      await logChange(who, 'projects', `${id ? 'Updated' : 'Added'} status “${label}”`);
      return res.status(200).json({ ok: true, id: sid });
    }

    if (op === 'retireStatus') {
      const id = Number(b.id);
      const inUse = await sql`SELECT count(*)::int AS n FROM projects WHERE active = true AND status_id = ${id}`;
      if (inUse[0].n > 0) {
        return res.status(409).json({ error: `${inUse[0].n} active project${inUse[0].n > 1 ? 's hold' : ' holds'} this status — move them first`, count: inUse[0].n });
      }
      const others = await sql`SELECT count(*)::int AS n FROM project_statuses WHERE active = true AND id <> ${id}`;
      if (others[0].n === 0) return res.status(409).json({ error: 'The last status stays — the ladder needs at least one rung' });
      const rows = await sql`UPDATE project_statuses SET active = false WHERE id = ${id} AND active = true RETURNING label`;
      if (!rows.length) return res.status(404).json({ error: 'No such status', id });
      await logChange(who, 'projects', `Retired status “${rows[0].label}”`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['saveTeam', 'retireTeam', 'saveStatus', 'retireStatus'] });
  } catch (err) {
    res.status(500).json({ error: 'Project admin operation failed — has Setup been run?', detail: String(err) });
  }
}
