import { neon } from '@neondatabase/serverless';
import { getExcluded } from '../excluded.js';

const sql = neon(process.env.DATABASE_URL);
const MIN_GAP_MS = 55 * 60 * 1000; // record at most ~hourly

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const EXCLUDED = await getExcluded();
    // Snapshot-on-read: if the newest snapshot is older than the gap, capture one now.
    // Organic page traffic acts as the scheduler — no paid cron needed.
    const last = await sql`SELECT MAX(captured_at) AS t FROM territory_snapshots`;
    const lastT = last[0] && last[0].t ? new Date(last[0].t).getTime() : 0;
    if (Date.now() - lastT > MIN_GAP_MS) {
      // Excluded in step with getLeaderboard, or the trend line and the
      // standings it sits next to would disagree by exactly TVO + LND.
      // NOTE: snapshots already captured before 2026-08-26 still include them,
      // so the 48-hour graph shows a one-time step down where the exclusion
      // landed. That is history being honest, not a bug — the old points were
      // really counted at the time.
      await sql`
        INSERT INTO territory_snapshots (territory, total_score)
        SELECT territory, SUM(total_score) FROM players
        WHERE trigram <> ALL(${EXCLUDED}::text[])
        GROUP BY territory
      `;
    }

    const rows = await sql`
      SELECT territory, total_score, captured_at
      FROM territory_snapshots
      WHERE captured_at > now() - interval '48 hours'
      ORDER BY captured_at ASC
    `;

    const series = {};
    for (const r of rows) {
      if (!series[r.territory]) series[r.territory] = [];
      series[r.territory].push({ t: r.captured_at, score: Number(r.total_score) });
    }

    res.status(200).json({ series });
  } catch (err) {
    res.status(500).json({ error: 'Trend failed', detail: String(err) });
  }
}
