import { sql, requireScope, cors } from './auth.js';
import { RETIRE_HOURS } from './retireWindow.js';

/*
  GET /api/admin/listQuestions?table=questions|methodology_questions|glossary_terms

  The admin view of the banks — INCLUDING the answer keys the public
  endpoints deliberately withhold. That is the point of the 'content' scope:
  an SME editing questions has to see which option is correct.

  The three tables have three different shapes (see saveQuestion), so this
  returns rows as-is per table rather than pretending to a common schema.

  Retired rows sort to the BOTTOM of every bank. Postgres orders a boolean
  DESC as true-then-false, so `active DESC` leads and each bank's own
  tiebreaker (id, category+id, term) still applies within each half. Sorting
  here rather than in the client means the filter in questions.js keeps
  working untouched — it filters an already-ordered array.
*/
const TABLES = ['questions', 'methodology_questions', 'glossary_terms'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'content');
  if (!who) return;

  const table = (req.query.table || '').toString();
  if (!TABLES.includes(table)) return res.status(400).json({ error: 'Bad table', tables: TABLES });

  try {
    // Sweep first, then list, so the response never shows a row that has
    // already run out its window. This is the only thing that deletes a
    // question — there is no cron, on purpose (no new infra, and a retired
    // row is already out of the game, so lingering costs nothing but a line
    // in this list). A pre-Setup database has no retired_at yet; that throws
    // here and is swallowed, same shape as saveEvent's end_date fallback.
    let purged = 0;
    try {
      const cutoff = `${RETIRE_HOURS} hours`;
      let gone;
      if (table === 'questions') {
        gone = await sql`DELETE FROM questions WHERE active = false
                         AND retired_at IS NOT NULL
                         AND retired_at < now() - ${cutoff}::interval RETURNING id`;
      } else if (table === 'methodology_questions') {
        gone = await sql`DELETE FROM methodology_questions WHERE active = false
                         AND retired_at IS NOT NULL
                         AND retired_at < now() - ${cutoff}::interval RETURNING id`;
      } else {
        gone = await sql`DELETE FROM glossary_terms WHERE active = false
                         AND retired_at IS NOT NULL
                         AND retired_at < now() - ${cutoff}::interval RETURNING id`;
      }
      purged = gone.length;
    } catch (err) {
      if (!/retired_at/.test(String(err))) throw err;   // real failure, not a missing column
    }

    // retired_at is a v11 column. On a pre-Setup database the rich SELECT
    // throws, so fall back to the pre-v11 shape rather than 500 the whole
    // view — the ring simply does not render until Setup has been run.
    let rows;
    try {
      if (table === 'questions') {
        rows = await sql`SELECT id, prompt, option_a, option_b, option_c, option_d,
                                correct_option, active, retired_at
                         FROM questions ORDER BY active DESC, id ASC`;
      } else if (table === 'methodology_questions') {
        rows = await sql`SELECT id, category, prompt, question, option_a, option_b,
                                option_c, option_d, correct, explanation, read_seconds,
                                active, retired_at
                         FROM methodology_questions ORDER BY active DESC, category ASC, id ASC`;
      } else {
        rows = await sql`SELECT id, term, definition, active, retired_at
                         FROM glossary_terms ORDER BY active DESC, term ASC`;
      }
    } catch (err) {
      if (!/retired_at/.test(String(err))) throw err;
      if (table === 'questions') {
        rows = await sql`SELECT id, prompt, option_a, option_b, option_c, option_d,
                                correct_option, active
                         FROM questions ORDER BY active DESC, id ASC`;
      } else if (table === 'methodology_questions') {
        rows = await sql`SELECT id, category, prompt, question, option_a, option_b,
                                option_c, option_d, correct, explanation, read_seconds, active
                         FROM methodology_questions ORDER BY active DESC, category ASC, id ASC`;
      } else {
        rows = await sql`SELECT id, term, definition, active
                         FROM glossary_terms ORDER BY active DESC, term ASC`;
      }
    }
    // retire_hours travels with the payload so the countdown ring reads the
    // window from the server instead of keeping a second copy of the number.
    res.status(200).json({ table, rows, retire_hours: RETIRE_HOURS, purged });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err) });
  }
}
