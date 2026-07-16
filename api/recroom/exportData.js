import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req, res) {
  // Gate: requires the export key as ?key=...
  if (!process.env.EXPORT_KEY || req.query.key !== process.env.EXPORT_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const rows = await sql`
      SELECT
        trigram, country_code, territory,
        total_score, attempted, correct,
        CASE WHEN attempted > 0
             THEN ROUND(100.0 * correct / attempted, 1)
             ELSE 0 END AS accuracy,
        games_played, first_seen, last_seen
      FROM players
      ORDER BY total_score DESC
    `;

    const headers = ['trigram','country_code','territory','total_score',
      'attempted','correct','accuracy','games_played','first_seen','last_seen'];

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => csvEscape(r[h])).join(','));
    }
    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="recroom_scores.csv"');
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', detail: String(err) });
  }
}
