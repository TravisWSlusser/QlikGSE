import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/saveQuestion — insert (no id) or update (id) in one of the
  three banks. Validation matches what the game actually depends on:

  questions (Brain Freeze)
    prompt, option_a-d, correct_option in a-d. The check endpoint lowercases
    correct_option, so it is stored lowercase here.

  methodology_questions (coins)
    category in term|green_sheet|blue_sheet (the wheel's three streams),
    prompt AND question (two distinct text fields, both rendered),
    option_a-d, correct in a-d, explanation (the post-answer teaching line),
    read_seconds 3-60 (drives the reading timer; a zero would make a
    question unanswerable).

  glossary_terms (Brain Blast)
    term, definition. checkTerm compares trim/lowercase, so a DUPLICATE term
    with a different definition would score as correct against either — this
    endpoint refuses to create one.
*/
const TABLES = ['questions', 'methodology_questions', 'glossary_terms'];
const CATEGORIES = ['term', 'green_sheet', 'blue_sheet'];
const LETTERS = ['a', 'b', 'c', 'd'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'content');
  if (!who) return;

  const b = parseBody(req);
  const table = (b.table || '').toString();
  if (!TABLES.includes(table)) return res.status(400).json({ error: 'Bad table', tables: TABLES });

  const id = b.id == null ? null : Number(b.id);
  const active = b.active === undefined ? true : !!b.active;
  const s = v => (v == null ? '' : String(v)).trim();

  try {
    let row;

    if (table === 'questions') {
      const prompt = s(b.prompt);
      const [oa, ob, oc, od] = [s(b.option_a), s(b.option_b), s(b.option_c), s(b.option_d)];
      const correct = s(b.correct_option).toLowerCase();
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
      if (!oa || !ob || !oc || !od) return res.status(400).json({ error: 'All four options are required' });
      if (!LETTERS.includes(correct)) return res.status(400).json({ error: 'correct_option must be a, b, c or d' });

      if (id) {
        const rows = await sql`UPDATE questions SET prompt=${prompt}, option_a=${oa}, option_b=${ob},
          option_c=${oc}, option_d=${od}, correct_option=${correct}, active=${active}
          WHERE id=${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such question', id });
        row = rows[0];
      } else {
        const rows = await sql`INSERT INTO questions (prompt, option_a, option_b, option_c, option_d, correct_option, active)
          VALUES (${prompt}, ${oa}, ${ob}, ${oc}, ${od}, ${correct}, ${active}) RETURNING id`;
        row = rows[0];
      }

    } else if (table === 'methodology_questions') {
      const category = s(b.category);
      const prompt = s(b.prompt), question = s(b.question);
      const [oa, ob, oc, od] = [s(b.option_a), s(b.option_b), s(b.option_c), s(b.option_d)];
      const correct = s(b.correct).toLowerCase();
      const explanation = s(b.explanation);
      const read_seconds = Math.round(Number(b.read_seconds));
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'category must be term, green_sheet or blue_sheet' });
      if (!prompt || !question) return res.status(400).json({ error: 'Both prompt and question are required' });
      if (!oa || !ob || !oc || !od) return res.status(400).json({ error: 'All four options are required' });
      if (!LETTERS.includes(correct)) return res.status(400).json({ error: 'correct must be a, b, c or d' });
      if (!Number.isInteger(read_seconds) || read_seconds < 3 || read_seconds > 60) {
        return res.status(400).json({ error: 'read_seconds must be 3-60' });
      }

      if (id) {
        const rows = await sql`UPDATE methodology_questions SET category=${category}, prompt=${prompt},
          question=${question}, option_a=${oa}, option_b=${ob}, option_c=${oc}, option_d=${od},
          correct=${correct}, explanation=${explanation}, read_seconds=${read_seconds}, active=${active}
          WHERE id=${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such question', id });
        row = rows[0];
      } else {
        const rows = await sql`INSERT INTO methodology_questions
          (category, prompt, question, option_a, option_b, option_c, option_d, correct, explanation, read_seconds, active)
          VALUES (${category}, ${prompt}, ${question}, ${oa}, ${ob}, ${oc}, ${od}, ${correct}, ${explanation}, ${read_seconds}, ${active})
          RETURNING id`;
        row = rows[0];
      }

    } else { // glossary_terms
      const term = s(b.term), definition = s(b.definition);
      if (!term) return res.status(400).json({ error: 'Term is required' });
      if (!definition) return res.status(400).json({ error: 'Definition is required' });

      // The scoring comparison is trim/lowercase, so uniqueness has to be too.
      const dupe = id
        ? await sql`SELECT id FROM glossary_terms WHERE lower(trim(term)) = lower(${term}) AND id <> ${id} LIMIT 1`
        : await sql`SELECT id FROM glossary_terms WHERE lower(trim(term)) = lower(${term}) LIMIT 1`;
      if (dupe.length) {
        return res.status(409).json({ error: 'That term already exists', existingId: dupe[0].id,
          detail: 'Brain Blast scores by term text, so two entries with the same term would both count as correct for either definition.' });
      }

      if (id) {
        const rows = await sql`UPDATE glossary_terms SET term=${term}, definition=${definition}, active=${active}
          WHERE id=${id} RETURNING id`;
        if (!rows.length) return res.status(404).json({ error: 'No such term', id });
        row = rows[0];
      } else {
        const rows = await sql`INSERT INTO glossary_terms (term, definition, active)
          VALUES (${term}, ${definition}, ${active}) RETURNING id`;
        row = rows[0];
      }
    }

    const what = table === 'glossary_terms' ? `term “${s(b.term)}”` : `question #${row.id}`;
    await logChange(who, 'questions', `${id ? 'Updated' : 'Created'} ${what} in ${table}`);
    res.status(200).json({ ok: true, id: row.id, table });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
