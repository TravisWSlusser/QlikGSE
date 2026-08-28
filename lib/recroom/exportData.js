import { neon } from '@neondatabase/serverless';
import { EXCLUDED } from '../excluded.js';
import { getSecret } from '../secrets.js';

const sql = neon(process.env.DATABASE_URL);

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req, res) {
  // Gate: requires the export key as ?key=... — resolved via CAPCOM's
  // Keys & Services (env var as fallback). Still fails closed when unset.
  const exportKey = await getSecret('EXPORT_KEY');
  if (!exportKey || req.query.key !== exportKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Deliberately NOT filtered by EXCLUDED. This is the tracking path: the
    // point of hiding someone from the boards was never to stop measuring
    // them, so the export stays complete and gains a column saying who is
    // hidden. It sits behind EXPORT_KEY, so it is not a way for the org to
    // read back what the leaderboard is not showing.
    const rows = await sql`
      SELECT
        trigram, country_code, territory,
        total_score, attempted, correct,
        CASE WHEN attempted > 0
             THEN ROUND(100.0 * correct / attempted, 1)
             ELSE 0 END AS accuracy,
        games_played, first_seen, last_seen,
        (trigram = ANY(${EXCLUDED}::text[])) AS excluded
      FROM players
      ORDER BY total_score DESC
    `;

    const headers = ['trigram','country_code','territory','total_score',
      'attempted','correct','accuracy','games_played','first_seen','last_seen',
      'excluded'];

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
