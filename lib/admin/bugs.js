import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/bugs — the Help section's bug reports.

  { op:'report', page, note }   any valid key or member — everyone can flag
  { op:'list' }                 any valid key — open reports are visible
  { op:'resolve', id }          managers + masters only

  Reports land in bug_reports (created by migrate v4) and in the change
  feed, so a fresh bug is visible on Home without anyone checking Help.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, null);
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'report') {
      const page = String(b.page || '').trim().slice(0, 80);
      const note = String(b.note || '').trim().slice(0, 2000);
      if (note.length < 5) return res.status(400).json({ error: 'Say a little more about what went wrong' });
      const rows = await sql`INSERT INTO bug_reports (page, note, actor)
        VALUES (${page}, ${note}, ${who.label}) RETURNING id`;
      await logChange(who, 'system', `Filed a bug report${page ? ` on ${page}` : ''}`);
      return res.status(200).json({ ok: true, id: rows[0].id });
    }

    if (op === 'list') {
      const rows = await sql`SELECT id, page, note, actor, created_at, resolved, resolved_by
        FROM bug_reports ORDER BY resolved, id DESC LIMIT 100`;
      return res.status(200).json({ ok: true, reports: rows });
    }

    if (op === 'resolve') {
      if (!who.master && !who.manager) return res.status(403).json({ error: 'Only managers resolve bug reports' });
      const id = Number(b.id);
      const rows = await sql`UPDATE bug_reports SET resolved = true, resolved_by = ${who.label}
        WHERE id = ${id} AND resolved = false RETURNING id`;
      if (!rows.length) return res.status(404).json({ error: 'No open report with that id', id });
      await logChange(who, 'system', `Resolved bug report #${id}`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['report', 'list', 'resolve'] });
  } catch (err) {
    res.status(500).json({ error: 'Bug report failed — has Setup been run?', detail: String(err) });
  }
}
