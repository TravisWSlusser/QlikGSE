import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/getTerritoryHigh
  Returns the best SINGLE-GAME score posted in each territory (from score_events).
  Used by the game's color-unlock bar: beat your territory's high to earn the next
  D.O.R.C. color. Reactive — recomputed each time a game launches, so the bar
  tracks the current top run in your region and keeps the competition live.

  Response: { highs: { "NAM": 9999, "APAC": 551, ... } }
*/
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    // The unlock gate is GREATEST(2500, real territory high). The 2,500 is a
    // read-time floor only — never written to the DB, never added to any total.
    // Once a real score beats 2,500, the gate becomes that genuine high score,
    // so unlocking a color always means beating the territory's current best.
    const rows = await sql`
      SELECT territory, max(points)::int AS high, count(*)::int AS events
      FROM score_events
      WHERE territory IS NOT NULL
      GROUP BY territory
    `;
    const FLOOR = 2500;
    const highs = { NAM: FLOOR, LATAM: FLOOR, EMEA: FLOOR, APAC: FLOOR };
    for (const r of rows){
      if (highs[r.territory] !== undefined) highs[r.territory] = Math.max(FLOOR, r.high);
      else highs[r.territory] = Math.max(FLOOR, r.high);
    }

    /* The floor makes this endpoint unreadable as a health check: an EMPTY
       score_events and one holding only sub-2500 runs both return 2500 for
       every territory, so "the colour unlocks look stuck" cannot be told from
       "nobody has beaten 2500 yet". That ambiguity cost a wrong diagnosis.

       events is the raw row count per territory, before the floor is applied.
       Zero everywhere means the insert in logScore is failing silently (it is
       wrapped in a catch that deliberately swallows errors so a logging fault
       can never fail a score write). Non-zero means the mechanic is working and
       the floor is simply doing its job. */
    const events = {};
    for (const r of rows) events[r.territory] = r.events;
    // Short cache: the bar only needs to be fresh-ish, and this protects Neon.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ highs, events });
  } catch (err) {
    res.status(500).json({ error: 'getTerritoryHigh failed', detail: String(err) });
  }
}
