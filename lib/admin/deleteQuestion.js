import { sql, requireScope, cors, parseBody } from './auth.js';

/*
  POST /api/admin/deleteQuestion — retire (active=false). Every game query
  filters on active=true, so a retired question leaves rotation instantly;
  the row stays so it can be restored (saveQuestion active=true) and so a
  question that has already been answered keeps its identity.

  Refuses to retire below a floor per bank: getTerms needs a distractor pool
  (n*6+12 for the 3-question scene → ~30 active terms) and an empty
  questions table would make Brain Freeze spawn nothing at all.
*/
const TABLES = { questions: 4, methodology_questions: 4, glossary_terms: 30 };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'content');
  if (!who) return;

  const b = parseBody(req);
  const table = (b.table || '').toString();
  const id = Number(b.id);
  if (!(table in TABLES)) return res.status(400).json({ error: 'Bad table', tables: Object.keys(TABLES) });
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id' });

  const floor = TABLES[table];
  try {
    // Tagged-template sql cannot parameterise an identifier, so each table
    // gets its own literal query — same pattern as listQuestions.
    let remaining;
    if (table === 'questions') {
      remaining = await sql`SELECT count(*)::int AS n FROM questions WHERE active = true AND id <> ${id}`;
    } else if (table === 'methodology_questions') {
      remaining = await sql`SELECT count(*)::int AS n FROM methodology_questions WHERE active = true AND id <> ${id}`;
    } else {
      remaining = await sql`SELECT count(*)::int AS n FROM glossary_terms WHERE active = true AND id <> ${id}`;
    }
    if (remaining[0].n < floor) {
      return res.status(409).json({
        error: `The game needs at least ${floor} active rows in ${table}`,
        detail: 'Add a replacement before retiring this one.'
      });
    }

    let rows;
    if (table === 'questions') {
      rows = await sql`UPDATE questions SET active = false WHERE id = ${id} RETURNING id`;
    } else if (table === 'methodology_questions') {
      rows = await sql`UPDATE methodology_questions SET active = false WHERE id = ${id} RETURNING id`;
    } else {
      rows = await sql`UPDATE glossary_terms SET active = false WHERE id = ${id} RETURNING id`;
    }
    if (!rows.length) return res.status(404).json({ error: 'No such row', id });
    res.status(200).json({ ok: true, id, table });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
