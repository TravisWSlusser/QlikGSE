import { neon } from '@neondatabase/serverless';

// Use whatever Vercel injected the Neon connection string as.
const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  GET /api/getQuestions?n=1
  Returns up to n random active questions WITHOUT the answer key.
  Not key-gated: exposes no secret (no correct_option, no writes), and the
  game iframe has no session key. The answer key stays server-side and is
  only ever evaluated by /api/checkAnswer.
*/
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const n = Math.min(Math.max(parseInt(req.query.n || '1', 10) || 1, 1), 10);
    const rows = await sql`
      SELECT id, prompt, option_a, option_b, option_c, option_d
      FROM questions
      WHERE active = true
      ORDER BY random()
      LIMIT ${n}
    `;
    const questions = rows.map(r => ({
      id: r.id,
      prompt: r.prompt,
      options: [
        { key: 'a', text: r.option_a },
        { key: 'b', text: r.option_b },
        { key: 'c', text: r.option_c },
        { key: 'd', text: r.option_d },
      ],
    }));
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(500).json({ error: 'getQuestions failed' });
  }
}
