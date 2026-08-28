import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/saveCategory — upsert a calendar category. The key is the
  identity (events reference it by key), so this can retitle or recolour a
  category but never rename its key — renaming would orphan every event that
  points at it. A new key is simply a new category.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'calendar');
  if (!who) return;

  const b = parseBody(req);
  const key = (b.key || '').toString().trim().toLowerCase();
  const label = (b.label || '').toString().trim();
  const color = (b.color || '').toString().trim();

  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) return res.status(400).json({ error: 'Bad key — lowercase letters, digits, underscore' });
  if (!label) return res.status(400).json({ error: 'Label is required' });
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Color must be #RRGGBB' });

  try {
    await sql`
      INSERT INTO event_categories (key, label, color) VALUES (${key}, ${label}, ${color})
      ON CONFLICT (key) DO UPDATE SET label = ${label}, color = ${color}`;
    await logChange(who, 'calendar', `Saved category “${label}” (${key})`);
    res.status(200).json({ ok: true, key });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
