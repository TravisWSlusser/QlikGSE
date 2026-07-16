import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  POST /api/checkTerm   body: { id, choice }   choice = chosen term string ('' on timeout)
  Validates the chosen term against the server-only correct term for that row.
  Returns whether it was correct plus the correct term (for the reveal display).
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
    const choice = String(body.choice || '').trim().toLowerCase();
    if (id == null) return res.status(400).json({ error: 'id required' });

    const rows = await sql`
      SELECT term FROM glossary_terms WHERE id = ${id} AND active = true LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'term not found' });
    const term = rows[0].term;
    return res.status(200).json({
      correct: choice === String(term).trim().toLowerCase(),
      term,   // the correct answer, for the reveal
    });
  } catch (e) {
    return res.status(500).json({ error: 'checkTerm failed' });
  }
}
