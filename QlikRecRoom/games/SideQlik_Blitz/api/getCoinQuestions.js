import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

const CATEGORIES = ['term', 'green_sheet', 'blue_sheet'];

/*
  GET /api/getCoinQuestions?category=blue_sheet&n=1
  Returns up to n random ACTIVE methodology questions of the given category,
  WITHOUT the answer key. Mirrors getQuestions: not key-gated (exposes no
  secret, no writes); the correct answer only ever surfaces from checkCoinAnswer
  after the player commits a guess.

  category drives the three coin types (term / green_sheet / blue_sheet). If
  category is missing or invalid, returns 400 — the game must say which coin.
*/
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const category = String(req.query.category || '').toLowerCase();
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'category must be term|green_sheet|blue_sheet' });
    }
    const n = Math.min(Math.max(parseInt(req.query.n || '1', 10) || 1, 1), 10);

    const rows = await sql`
      SELECT id, category, prompt, question, option_a, option_b, option_c, option_d, read_seconds
      FROM methodology_questions
      WHERE active = true AND category = ${category}
      ORDER BY random()
      LIMIT ${n}
    `;

    const questions = rows.map(r => ({
      id: r.id,
      category: r.category,
      prompt: r.prompt,
      question: r.question,
      options: [
        { key: 'a', text: r.option_a },
        { key: 'b', text: r.option_b },
        { key: 'c', text: r.option_c },
        { key: 'd', text: r.option_d },
      ],
      read_seconds: r.read_seconds,
    }));

    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(500).json({ error: 'getCoinQuestions failed' });
  }
}
