import { neon } from '@neondatabase/serverless';

// Use whatever Vercel injected the Neon connection string as.
const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  POST /api/checkAnswer   body: { id, choice }   choice = 'a'|'b'|'c'|'d'
  Validates the pick against the server-only correct_option and returns
  whether it was correct (plus the correct key, for post-answer learning).
  The answer key is never sent by getQuestions; it only ever surfaces here,
  after the player has committed a guess.
*/
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = body.id;
    const choice = String(body.choice || '').toLowerCase();
    if (id == null || !['a', 'b', 'c', 'd'].includes(choice)) {
      return res.status(400).json({ error: 'id and choice (a|b|c|d) required' });
    }
    const rows = await sql`
      SELECT correct_option FROM questions WHERE id = ${id} AND active = true LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'question not found' });
    const correctKey = String(rows[0].correct_option).toLowerCase();
    return res.status(200).json({ correct: choice === correctKey, correct_option: correctKey });
  } catch (e) {
    return res.status(500).json({ error: 'checkAnswer failed' });
  }
}
