import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/roster — the REC roster: trigram → real identity,
  imported from the Mindtickle user export (UserRoster*.xlsx, converted
  to JSON). Powers the scoreboard hover cards in the REC Room.

  { op:'import', rows:[{trigram,name,country,iso2,title,active}] }
      upsert, chunked by the client (a few hundred rows per call).
      Managers + masters only.
  { op:'stats' }   → { count, updated }   any projects-scope key.

  The roster is employee data. It lives in the DATABASE only — never in
  the public repo — and the room's endpoints serve it per-scoreboard-row,
  never wholesale.
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
    if (op === 'import') {
      if (!who.master && !who.manager) {
        return res.status(403).json({ error: 'Only managers import the roster' });
      }
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'No rows' });
      if (rows.length > 500) return res.status(400).json({ error: 'Send at most 500 rows per call' });
      let n = 0;
      for (const r of rows) {
        const tri = String(r.trigram || '').trim().toUpperCase();
        const name = String(r.name || '').trim().slice(0, 80);
        if (!TRIGRAM.test(tri) || name.length < 2) continue;
        await sql`INSERT INTO rec_roster (trigram, name, country, iso2, title, active, updated_at)
          VALUES (${tri}, ${name}, ${String(r.country || '').slice(0, 60)},
                  ${String(r.iso2 || '').toLowerCase().slice(0, 2)},
                  ${String(r.title || '').slice(0, 120)}, ${r.active !== false}, now())
          ON CONFLICT (trigram) DO UPDATE SET
            name = EXCLUDED.name, country = EXCLUDED.country, iso2 = EXCLUDED.iso2,
            title = EXCLUDED.title, active = EXCLUDED.active, updated_at = now()`;
        n++;
      }
      await logChange(who, 'system', `Imported ${n} roster rows`);
      return res.status(200).json({ ok: true, imported: n });
    }

    if (op === 'stats') {
      const rows = await sql`SELECT count(*)::int AS count, max(updated_at) AS updated FROM rec_roster`;
      return res.status(200).json({ ok: true, count: rows[0].count, updated: rows[0].updated });
    }

    res.status(400).json({ error: 'Bad op', ops: ['import', 'stats'] });
  } catch (err) {
    res.status(500).json({ error: 'Roster operation failed — has Setup been run?', detail: String(err) });
  }
}
