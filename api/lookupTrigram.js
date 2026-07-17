import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const trigram = (req.query.trigram || '').toString().trim().toUpperCase();

  if (!/^[A-Z]{2,4}$/.test(trigram)) {
    return res.status(400).json({ error: 'Invalid or missing trigram' });
  }

  try {
    const rows = await sql`
      SELECT trigram, country_code, territory, total_score, games_played
      FROM players
      WHERE trigram = ${trigram}
      LIMIT 1
    `;

    if (rows.length === 0) {
      // First-timer: fall back to the Mindtickle roster to pre-fill the sign-in
      // boxes. They aren't a player yet (exists:false), but prefill seeds the form.
      const seed = await sql`
        SELECT territory, country_code, mt_user_id FROM mt_roster WHERE trigram = ${trigram} LIMIT 1
      `;
      if (seed.length) {
        return res.status(200).json({
          exists: false, prefill: true,
      mt_user_id: roster[0].mt_user_id || null,
          territory: seed[0].territory, country_code: seed[0].country_code
        });
      }
      return res.status(200).json({ exists: false });
    }

    const p = rows[0];
    return res.status(200).json({
      exists: true,
      trigram: p.trigram,
      territory: p.territory,
      country_code: p.country_code,
      total_score: p.total_score,
      games_played: p.games_played
    });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', detail: String(err) });
  }
}
