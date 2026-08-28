import { sql, requireScope, cors } from './auth.js';

/*
  GET /api/admin/questionStats — per-question answer performance, for
  "where do people need guidance?".

  The counters live ON the question rows (attempted/correct, bumped by the
  game's check endpoints) and started collecting when those endpoints
  gained the bump — there is no historical per-question data before that,
  so a young deployment legitimately returns thin numbers.

  Open to `analytics` OR `content`: the SMEs who maintain the banks are
  exactly the people who need to see what players get wrong.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, ['analytics', 'content']);
  if (!who) return;

  try {
    const q = await sql`
      SELECT id, prompt AS label, attempted, correct FROM questions
      WHERE attempted > 0 ORDER BY attempted DESC`;
    const c = await sql`
      SELECT id, COALESCE(NULLIF(question, ''), prompt) AS label, category, attempted, correct
      FROM methodology_questions WHERE attempted > 0 ORDER BY attempted DESC`;
    const t = await sql`
      SELECT id, term AS label, attempted, correct FROM glossary_terms
      WHERE attempted > 0 ORDER BY attempted DESC`;

    const tag = (rows, table, game) => rows.map(r => ({ ...r, table, game }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      rows: [
        ...tag(q, 'questions', 'Brain Freeze'),
        ...tag(c, 'methodology_questions', 'Methodology'),
        ...tag(t, 'glossary_terms', 'Brain Blast'),
      ],
      minAttempts: 5, // below this, a miss rate is noise — the client labels accordingly
    });
  } catch (err) {
    // Columns not migrated yet — no data, not an error.
    res.status(200).json({ rows: [], pending: true });
  }
}
