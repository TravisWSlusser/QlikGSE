import { neon } from '@neondatabase/serverless';
import { getExcluded } from '../excluded.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const since = parseInt(req.query.since, 10);
  const sinceId = Number.isInteger(since) && since > 0 ? since : 0;

  try {
    const EXCLUDED = await getExcluded();
    const rows = await sql`
      SELECT id, trigram, territory, country_code, points, created_at
      FROM score_events
      WHERE id > ${sinceId}
        AND trigram <> ALL(${EXCLUDED}::text[])
      ORDER BY id ASC
      LIMIT 25
    `;
    res.status(200).json({ events: rows });
  } catch (err) {
    res.status(500).json({ error: 'Events failed', detail: String(err) });
  }
}
