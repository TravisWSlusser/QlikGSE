import { sql, requireScope, cors } from './auth.js';
import { logChange } from './log.js';

/*
  POST /api/admin/dedupeTerms — retire exact-duplicate glossary terms.

  Born from a real incident: the glossary seed import ran twice and every
  term existed exactly twice (248 rows, 124 unique, ids offset by 124).
  Brain Blast scores by term TEXT, so a duplicated term counts either copy
  as correct — and the distractor pool could deal the same word twice in
  one question.

  Deliberately narrow: it only touches ACTIVE rows whose term AND definition
  both match (case/whitespace-insensitive) a lower-id active keeper. A
  duplicate term with a DIFFERING definition is a judgment call, so it is
  counted and reported, never auto-retired. Answer counters fold into the
  keeper first so no stats are lost. One change-feed entry, not one per row.

  System scope. Idempotent — a second run finds nothing.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'system');
  if (!who) return;

  try {
    // Fold counters from each dupe into its keeper (lowest active id with
    // the same term+definition), so the stats survive the retirement.
    await sql`
      UPDATE glossary_terms k SET
        attempted = k.attempted + d.attempted,
        correct   = k.correct + d.correct
      FROM glossary_terms d
      WHERE k.active = true AND d.active = true AND k.id < d.id
        AND lower(trim(k.term)) = lower(trim(d.term))
        AND lower(trim(k.definition)) = lower(trim(d.definition))
        AND NOT EXISTS (
          SELECT 1 FROM glossary_terms k2
          WHERE k2.active = true AND k2.id < k.id
            AND lower(trim(k2.term)) = lower(trim(d.term))
            AND lower(trim(k2.definition)) = lower(trim(d.definition))
        )`;

    const retired = await sql`
      UPDATE glossary_terms g SET active = false
      WHERE g.active = true AND EXISTS (
        SELECT 1 FROM glossary_terms k
        WHERE k.active = true AND k.id < g.id
          AND lower(trim(k.term)) = lower(trim(g.term))
          AND lower(trim(k.definition)) = lower(trim(g.definition))
      ) RETURNING id`;

    // Same term, different definition — report, never decide.
    const conflicted = await sql`
      SELECT lower(trim(term)) AS t, count(*)::int AS n FROM glossary_terms
      WHERE active = true GROUP BY 1 HAVING count(*) > 1`;

    const remaining = await sql`SELECT count(*)::int AS n FROM glossary_terms WHERE active = true`;

    if (retired.length) {
      await logChange(who, 'questions',
        `Deduped the glossary: retired ${retired.length} exact duplicates, ${remaining[0].n} active terms remain`);
    }
    res.status(200).json({
      ok: true,
      retired: retired.length,
      activeRemaining: remaining[0].n,
      needsHumanReview: conflicted.map(c => c.t), // same term, differing definitions
    });
  } catch (err) {
    res.status(500).json({ error: 'Dedupe failed', detail: String(err) });
  }
}
