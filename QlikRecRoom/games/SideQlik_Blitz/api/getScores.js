import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/getScores  —  read-only arcade leaderboard feed.

  Returns every player who has actually PLAYED (games_played > 0), grouped by
  territory, sorted by their Blitz personal-high score (descending). No secret
  required — this is public competitive data, the same scores shown on the
  REC Room board. The game fetches this directly for its game-over arcade table.

  Privacy: roster trigrams that have never played are excluded (games_played>0),
  so no one is exposed before they participate.

  Response:
  { territories: {
      NAM:   [ { trigram, country_code, high, longestSec, games }, ... ],
      LATAM: [ ... ], EMEA: [ ... ], APAC: [ ... ]
  } }
*/
const TERRITORIES = ['NAM', 'LATAM', 'EMEA', 'APAC'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const rows = await sql`
      SELECT trigram, country_code, territory,
             blitz_personal_high AS high,
             blitz_longest_sec   AS longest_sec,
             games_played        AS games
      FROM players
      WHERE games_played > 0
      ORDER BY territory, blitz_personal_high DESC, trigram
    `;

    const territories = { NAM: [], LATAM: [], EMEA: [], APAC: [] };
    for (const r of rows) {
      if (!territories[r.territory]) continue;
      territories[r.territory].push({
        trigram: r.trigram,
        country_code: r.country_code,
        high: r.high,
        longestSec: r.longest_sec,
        games: r.games,
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.status(200).json({ territories });
  } catch (err) {
    res.status(500).json({ error: 'getScores failed', detail: String(err) });
  }
}
