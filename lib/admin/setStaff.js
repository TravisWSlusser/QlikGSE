import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';
import { bustExcludedCache } from '../excluded.js';

/*
  POST /api/admin/setStaff — tag or untag a player as staff.
  { trigram, staff: true|false }. System scope: hiding someone from every
  public board is consequential, and so is quietly putting them back.

  Semantics are the excluded-list contract, unchanged: staff players still
  score, still see their own badge, still export — they just vanish from
  everything ranked or summed within ~a minute (60s read cache). Untagging
  brings them back with their real total, because nothing on the write path
  ever knew the flag existed.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'system');
  if (!who) return;

  const b = parseBody(req);
  const trigram = (b.trigram || '').toString().trim().toUpperCase();
  const staff = !!b.staff;
  if (!/^[A-Z]{2,4}$/.test(trigram)) return res.status(400).json({ error: 'Bad trigram' });

  try {
    const rows = await sql`
      UPDATE players SET staff = ${staff} WHERE trigram = ${trigram} RETURNING trigram`;
    if (!rows.length) return res.status(404).json({ error: 'No such player', trigram });
    bustExcludedCache();
    await logChange(who, 'players', staff
      ? `Tagged ${trigram} as staff — off the public boards`
      : `Untagged ${trigram} — back on the public boards with their real total`);
    res.status(200).json({ ok: true, trigram, staff });
  } catch (err) {
    res.status(500).json({ error: 'Write failed — has Setup been run?', detail: String(err) });
  }
}
