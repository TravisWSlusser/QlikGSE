/* =============================================================
   EXCLUDED TRIGRAMS  —  people who play but do not compete.

   Travis (TVO) and Nick (LND) build and run the REC Room. They play it more
   than anyone, most of it while testing, so their totals say nothing about
   engagement and their presence at the top of a board the org is meant to
   compete on is a bad look. Nick raised it; Travis agreed. Added 2026-08-26.

   WHAT THIS IS NOT: it is not a delete, and it is not a stop-scoring flag.
   Excluded players score exactly as before — every run still writes to
   `players` and `score_events`, totals still accumulate, personal bests still
   climb. Nothing about the write path knows this list exists. The exclusion is
   applied at READ time, and only to the views the org sees.

   HIDDEN FROM                         STILL SEES THEM
   ---------------------------------   ---------------------------------
   getLeaderboard  territory totals    lookupTrigram   (their own badge —
   getLeaderboard  top 3 per territory                  this is how they keep
   getLeaderboard  game masters                         track of themselves)
   getRecentScores activity + map      exportData      (the full CSV, with an
   getTerritoryHigh colour unlocks                      `excluded` column)
   trend           territory graph

   So an excluded player opens the room, signs in, sees their own trigram,
   their own total and their own games played, and plays a normal game. They
   simply do not appear in anything ranked or summed.

   WHY A CONSTANT AND NOT A COLUMN. A boolean on `players` would be the
   textbook answer and is the right upgrade if this list ever grows or needs
   changing by someone who cannot deploy. It was not done now for two honest
   reasons: it needs an ALTER TABLE that has to land before the code that
   reads it (or every board 500s in between), and the list is two people who
   are also the only two who could run the migration. A constant ships in one
   step with no window where the two halves disagree.

   TO CHANGE: edit the array and push. To put someone back in the running,
   remove them — their score was accumulating the whole time, so they rejoin
   with their real total rather than from zero. That is deliberate.
   ============================================================= */

export const EXCLUDED_TRIGRAMS = ['TVO', 'LND'];

/* Guard the shape rather than trusting the literal above. These values are
   interpolated into SQL as a bound array parameter; the format check is belt
   and braces on top of that, and it also catches the likelier mistake of a
   lowercase or padded entry silently matching nothing. */
export const EXCLUDED = EXCLUDED_TRIGRAMS
  .map(t => String(t).trim().toUpperCase())
  .filter(t => /^[A-Z]{2,4}$/.test(t));

/* True when a row should be kept out of a public view. For the endpoints that
   filter in JS rather than SQL. */
export const isExcluded = trigram =>
  EXCLUDED.includes(String(trigram || '').trim().toUpperCase());

/* =============================================================
   THE COLUMN UPGRADE, landed 2026-08-28 via CAPCOM.

   `players.staff` (boolean, added by CAPCOM's migrate) is now the source of
   truth; Travis tags and untags people from the Players view without a
   deploy. The constant above became the FALLBACK: getExcluded() returns the
   staff-flagged trigrams, and if the column does not exist yet (migrate not
   run) or the query fails, it returns EXCLUDED — so the two-halves-disagree
   window the original note worried about cannot happen: worst case is the
   old behaviour, never a 500.

   60s cache per warm lambda; CAPCOM's setStaff busts it on write.
   ============================================================= */
import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const _sql = neon(CONN);

let _cache = { at: 0, list: null };

export async function getExcluded() {
  if (_cache.list && Date.now() - _cache.at < 60_000) return _cache.list;
  try {
    const rows = await _sql`SELECT trigram FROM players WHERE staff IS TRUE`;
    _cache.list = rows.map(r => String(r.trigram).trim().toUpperCase())
      .filter(t => /^[A-Z]{2,4}$/.test(t));
  } catch {
    _cache.list = _cache.list || EXCLUDED; // column not migrated yet, or db blip
  }
  _cache.at = Date.now();
  return _cache.list;
}

export function bustExcludedCache() { _cache = { at: 0, list: null }; }
