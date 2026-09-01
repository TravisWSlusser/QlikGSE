import { sql, cors, parseBody } from './auth.js';
import { makeSalt, hashCode } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/memberClaim — the one deliberately UNAUTHENTICATED
  admin action: it is how a member gets a credential in the first place.

  { trigram, code } → sets the member's access code, once.

  The gate is the registry itself (Travis's tag-first rule): only an
  ACTIVE team_members row with that trigram and NO code yet can claim.
  A claimed member is refused — an admin resets from the Members manager
  and the member claims again. The residual risk — someone claiming a
  colleague's UNCLAIMED access before they do — is accepted for an
  internal team: it shows in the change feed and a reset undoes it.

  The code is stored as scrypt(code, salt) only. This handler must never
  echo, log, or store the plaintext.
*/
const TRIGRAM = /^[A-Za-z]{3}$/;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = parseBody(req);
  const trigram = String(b.trigram || '').trim().toUpperCase();
  const code = String(b.code || '');
  if (!TRIGRAM.test(trigram)) return res.status(400).json({ error: 'Trigrams are three letters' });
  if (code !== code.trim() || code.length < 8 || code.length > 64) {
    return res.status(400).json({ error: 'Access codes are 8–64 characters, with no leading or trailing spaces' });
  }

  try {
    const rows = await sql`
      SELECT id, name, code_hash FROM team_members
      WHERE active = true AND trigram = ${trigram} LIMIT 1`;
    if (!rows.length) {
      return res.status(404).json({ error: 'No team member with that trigram — ask an admin to add you on the Project Board first' });
    }
    if (rows[0].code_hash) {
      return res.status(409).json({ error: 'That access is already claimed — ask an admin to reset it from the Members manager' });
    }
    const salt = makeSalt();
    const hash = hashCode(code, salt);
    await sql`UPDATE team_members
      SET code_hash = ${hash}, code_salt = ${salt}, claimed_at = now()
      WHERE id = ${rows[0].id}`;
    await logChange({ label: `${rows[0].name} (gate)` }, 'projects',
      `${rows[0].name} claimed their member access (${trigram})`);
    return res.status(200).json({ ok: true, name: rows[0].name });
  } catch (err) {
    return res.status(500).json({ error: 'Claim failed — has Setup been run?', detail: String(err) });
  }
}
