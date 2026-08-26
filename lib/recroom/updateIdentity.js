import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const TERRITORIES = ['NAM', 'LATAM', 'EMEA', 'APAC'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── Key gate ──
  // Identical to logScore's: both session vars, each possibly a comma-separated
  // list so a key can be rotated with an overlap. It used to accept
  // MT_SESSION_REF alone and compare it whole, which meant two things went
  // wrong quietly: a phone (MT_SESSION_REF_MOBILE) could never change its own
  // territory, and the moment either var held a rotation list every caller got
  // a 401 because "old,new" never equals "new".
  const KEYS = [process.env.MT_SESSION_REF, process.env.MT_SESSION_REF_MOBILE]
    .filter(k => typeof k === 'string' && k.length > 0)
    .flatMap(k => k.split(',').map(s => s.trim()))
    .filter(Boolean);

  // Same transport-damage tolerance as logScore — see the long note there.
  // Kept in step deliberately: a key that scores but cannot set a territory
  // is a worse bug than one that fails outright, because it looks like it
  // worked.
  const submitted = (body.key == null ? '' : String(body.key));
  const candidates = new Set([
    submitted,
    submitted.trim(),
    submitted.replace(/ /g, '+'),
    submitted.trim().replace(/ /g, '+')
  ]);
  // Off permanently 2026-08-26, in step with logScore's REQUIRE_KEY — see the
  // long note there. Kept in step deliberately and for a concrete reason: this
  // endpoint has no bypass of its own, so leaving it gated while logScore was
  // open would mean a player could bank points but not set their territory,
  // and the failure is a silent 401 the page reports as a relocate that did
  // not happen. Both on, or both off.
  const REQUIRE_KEY = false;
  if (REQUIRE_KEY && (!KEYS.length || !KEYS.some(k => candidates.has(k)))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const trigram = (body.trigram || '').toString().trim().toUpperCase();
  const territory = (body.territory || '').toString().trim().toUpperCase();
  const country = (body.country_code || '').toString().trim().toLowerCase();

  if (!/^[A-Z]{2,4}$/.test(trigram)) return res.status(400).json({ error: 'Bad trigram' });
  if (!TERRITORIES.includes(territory)) return res.status(400).json({ error: 'Bad territory' });
  if (country && !/^[a-z]{2}$/.test(country)) return res.status(400).json({ error: 'Bad country_code' });

  try {
    // Relocation keeps the SAME row, so accumulated points follow automatically.
    // Only ever touches an existing player; new players are created at first logScore.
    const rows = await sql`
      UPDATE players
      SET territory    = ${territory},
          country_code = COALESCE(NULLIF(${country}, ''), country_code),
          last_seen    = now()
      WHERE trigram = ${trigram}
      RETURNING trigram, territory, country_code, total_score, games_played
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    res.status(200).json({ ok: true, player: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Update failed', detail: String(err) });
  }
}
