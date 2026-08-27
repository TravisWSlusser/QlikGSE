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
