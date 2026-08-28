import { sql, requireScope, cors } from './auth.js';

/*
  GET /api/admin/listQuestions?table=questions|methodology_questions|glossary_terms

  The admin view of the banks — INCLUDING the answer keys the public
  endpoints deliberately withhold. That is the point of the 'content' scope:
  an SME editing questions has to see which option is correct.

  The three tables have three different shapes (see saveQuestion), so this
  returns rows as-is per table rather than pretending to a common schema.
*/
const TABLES = ['questions', 'methodology_questions', 'glossary_terms'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'content');
  if (!who) return;

  const table = (req.query.table || '').toString();
  if (!TABLES.includes(table)) return res.status(400).json({ error: 'Bad table', tables: TABLES });

  try {
    let rows;
    if (table === 'questions') {
      rows = await sql`SELECT id, prompt, option_a, option_b, option_c, option_d,
                              correct_option, active
                       FROM questions ORDER BY id ASC`;
    } else if (table === 'methodology_questions') {
      rows = await sql`SELECT id, category, prompt, question, option_a, option_b,
                              option_c, option_d, correct, explanation, read_seconds, active
                       FROM methodology_questions ORDER BY category ASC, id ASC`;
    } else {
      rows = await sql`SELECT id, term, definition, active
                       FROM glossary_terms ORDER BY term ASC`;
    }
    res.status(200).json({ table, rows });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err) });
  }
}
