import { neon } from '@neondatabase/serverless';
import { getExcluded } from '../excluded.js';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/getRecentScores  —  the Recent Activity feed for the map + panel.

  Returns the 50 most-recently-active trigrams from `players` — one row per
  person (PK dedupes), each with their LAST session score and lifetime total.

  CADENCE (Neon-free-tier-safe):
    - Boards refresh every 360s (6 min).
    - Response is CDN-cached for 300s (5 min), so the whole org is served from
      ONE Neon query per interval no matter how many sellers are watching.
    - 6-min refresh > 5-min scale-to-zero -> Neon suspends between refreshes,
      keeping the feed well under the 100 CU-hour/month Free cap.
    - Net DB load: ~10 wakes/hour, fractions of a CU-hour per month.

  Bursts fire on boards for any trigram whose last_score changed since the
  prior refresh — so a score posted now appears (and bursts) within ~6 min.
*/
const REFRESH_SECONDS = 600;   // 10 min pool refresh   // board refresh interval (6 min)
const CACHE_SECONDS   = 540;   // 9 min CDN (< refresh, each tick is fresh)   // CDN cache (5 min, < refresh so each tick is fresh)
const POOL_SIZE       = 50;    // unique trigrams in the recent-activity pool

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const EXCLUDED = await getExcluded();
    // last_score > 0 — a signed-in trigram that has never banked a run is not
    // "recent activity". `players` gets a row from updateIdentity as soon as
    // somebody enters a trigram, so before this filter 44 of the 50 rows here
    // were zeros: the panel listed them as scores of 0, and the map fired
    // bursts for them. Filtering on last_score (not total_score) because
    // last_score is the number this feed actually renders, so the filter and
    // the display agree — a row can never show a 0.
    const scores = await sql`
      SELECT trigram, territory, country_code, last_score, total_score
      FROM players
      WHERE last_score > 0
        AND trigram <> ALL(${EXCLUDED}::text[])
      ORDER BY last_seen DESC
      LIMIT ${POOL_SIZE}
    `;

    // Identity for the hover cards — per ROW shown, never the whole roster
    // (employee data). Sub-wrapped: no roster, no problem.
    try {
      const tris = [...new Set(scores.map(s => s.trigram))];
      if (tris.length) {
        const who = await sql`SELECT trigram, name, title, country, iso2 FROM rec_roster
          WHERE active = true AND trigram = ANY(${tris}::text[])`;
        const byTri = Object.fromEntries(who.map(w => [w.trigram, w]));
        for (const s of scores) {
          const w = byTri[s.trigram];
          if (w) { s.name = w.name; s.title = w.title; s.country = w.country; s.iso2 = w.iso2; }
        }
      }
    } catch { /* roster not imported yet — trigrams stand alone */ }

    res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    res.status(200).json({
      scores,
      refreshSeconds: REFRESH_SECONDS,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'getRecentScores failed', detail: String(err) });
  }
}
