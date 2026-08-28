import { neon } from '@neondatabase/serverless';
import { getExcluded } from '../excluded.js';

const sql = neon(process.env.DATABASE_URL);

/* Every query below filters the same way: `trigram <> ALL($1::text[])`.
   An empty EXCLUDED array makes that TRUE for every row, so emptying the list
   restores the old behaviour exactly — the filter cannot half-apply. */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const EXCLUDED = await getExcluded();
    // Territory aggregate standings (left panel) + accuracy
    const territories = await sql`
      SELECT
        territory,
        SUM(total_score)                                   AS total_score,
        SUM(attempted)                                     AS attempted,
        SUM(correct)                                       AS correct,
        CASE WHEN SUM(attempted) > 0
             THEN ROUND(100.0 * SUM(correct) / SUM(attempted), 1)
             ELSE 0 END                                    AS accuracy
      FROM players
      WHERE trigram <> ALL(${EXCLUDED}::text[])
      GROUP BY territory
      ORDER BY total_score DESC
    `;

    // Top 3 players within each territory (window function)
    const topByTerritory = await sql`
      SELECT trigram, country_code, territory, total_score, accuracy FROM (
        SELECT
          trigram, country_code, territory, total_score,
          CASE WHEN attempted > 0
               THEN ROUND(100.0 * correct / attempted, 1)
               ELSE 0 END AS accuracy,
          ROW_NUMBER() OVER (PARTITION BY territory ORDER BY total_score DESC, trigram) AS rn
        FROM players
        WHERE trigram <> ALL(${EXCLUDED}::text[])
      ) t
      WHERE rn <= 3
      ORDER BY territory, total_score DESC
    `;

    // Worldwide top 3 = Game Masters
    const gameMasters = await sql`
      SELECT
        trigram, country_code, territory, total_score,
        CASE WHEN attempted > 0
             THEN ROUND(100.0 * correct / attempted, 1)
             ELSE 0 END AS accuracy
      FROM players
      WHERE trigram <> ALL(${EXCLUDED}::text[])
      ORDER BY total_score DESC, trigram
      LIMIT 3
    `;

    const byTerritory = { NAM: [], LATAM: [], EMEA: [], APAC: [] };
    for (const p of topByTerritory) {
      if (byTerritory[p.territory]) byTerritory[p.territory].push(p);
    }

    res.status(200).json({ territories, byTerritory, gameMasters });
  } catch (err) {
    res.status(500).json({ error: 'Query failed', detail: String(err) });
  }
}
