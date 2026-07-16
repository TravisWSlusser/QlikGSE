import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/*
  GET /api/getTerms?n=3
  Returns N glossary questions. Each: { id, def, options:[4 term strings] }.
  The correct term is one of the options but NOT flagged — the answer key stays
  server-side and is only resolved by /api/checkTerm.
*/
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const n = Math.min(Math.max(parseInt(req.query.n || '3', 10) || 3, 1), 10);
    const answers = await sql`
      SELECT id, term, definition FROM glossary_terms WHERE active = true ORDER BY random() LIMIT ${n}
    `;
    // a pool of term names to draw distractors from
    const pool = await sql`
      SELECT term FROM glossary_terms WHERE active = true ORDER BY random() LIMIT ${n * 6 + 12}
    `;
    const names = pool.map(p => p.term);
    const questions = answers.map(a => {
      const used = new Set([a.term]);
      const decoys = [];
      for (const nm of names) { if (decoys.length >= 3) break; if (!used.has(nm)) { used.add(nm); decoys.push(nm); } }
      const options = shuffle([a.term, ...decoys]);
      return { id: a.id, def: a.definition, options };
    });
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(500).json({ error: 'getTerms failed' });
  }
}
