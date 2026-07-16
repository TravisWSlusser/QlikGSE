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

  // ── Key gate (same session secret as logScore) ──
  if (!process.env.MT_SESSION_REF || body.key !== process.env.MT_SESSION_REF) {
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
