import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/hotlinks — the shared quick-links bar on CAPCOM's Home.

  Any valid key can list, add, edit, or retire a link: the bar is shared
  navigation for the leaders, not a privileged surface, and every change is
  attributed in the feed by key label — that is the accountability, not a
  scope gate. Links are https-only and soft-deleted like everything else.

  { op: 'list' }
  { op: 'save', id?, label, href }        // no id = create
  { op: 'delete', id }                    // active=false
*/
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
        SELECT id, label, href, sort, active, created_by FROM hotlinks
        WHERE active = true ORDER BY sort ASC, id ASC`;
      return res.status(200).json({ links: rows });
    }

    if (op === 'save') {
      const id = b.id == null ? null : Number(b.id);
      const label = (b.label || '').toString().trim();
      const href = (b.href || '').toString().trim();
      if (!label || label.length > 30) return res.status(400).json({ error: 'Label is required, max 30 characters' });
      if (!/^https:\/\/.{1,500}$/.test(href)) return res.status(400).json({ error: 'Link must be https:// (max 500 chars)' });

      let row;
      if (id) {
        const rows = await sql`UPDATE hotlinks SET label = ${label}, href = ${href}, updated_at = now()
          WHERE id = ${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such link', id });
        row = rows[0];
      } else {
        const rows = await sql`INSERT INTO hotlinks (label, href, created_by)
          VALUES (${label}, ${href}, ${who.label}) RETURNING id`;
        row = rows[0];
      }
      await logChange(who, 'hotlinks', `${id ? 'Updated' : 'Added'} hotlink “${label}”`);
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (op === 'delete') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });
      const rows = await sql`UPDATE hotlinks SET active = false, updated_at = now()
        WHERE id = ${id} RETURNING label`;
      if (!rows.length) return res.status(404).json({ error: 'No such link', id });
      await logChange(who, 'hotlinks', `Removed hotlink “${rows[0].label}”`);
      return res.status(200).json({ ok: true, id });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'save', 'delete'] });
  } catch (err) {
    res.status(500).json({ error: 'Hotlink operation failed — has Setup been run?', detail: String(err) });
  }
}
