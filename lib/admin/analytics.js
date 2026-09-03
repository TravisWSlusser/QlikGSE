import { sql, requireScope, cors } from './auth.js';
import { getExcluded } from '../excluded.js';

/*
  GET /api/admin/analytics — the dashboard's single payload, one round trip
  (the BRUCE /api/state pattern).

  This is the read path for two things the game has been writing since day
  one that NOTHING else reads: the per-learning-stream counters on players
  (q_* knowledge, c_* methodology coins, t_* glossary terms) and the
  score_events per-run log.

  Excluded players (TVO/LND) are INCLUDED here and flagged, per the
  exportData precedent: hiding someone from the public boards was never
  meant to stop measuring them, and an admin view that silently drops the
  two most active players would misreport every total.

  Read-only. Does not touch territory_snapshots — polling /api/recroom/trend
  from a dashboard would manufacture a snapshot row every ~55 minutes, so
  the trend series here is computed from score_events instead.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'analytics');
  if (!who) return;

  try {
    const EXCLUDED = await getExcluded();
    const totals = await sql`
      SELECT count(*)::int AS players,
             COALESCE(SUM(games_played), 0)::int AS games,
             COALESCE(SUM(total_score), 0)::bigint AS points,
             COALESCE(SUM(attempted), 0)::int AS attempted,
             COALESCE(SUM(correct), 0)::int AS correct
      FROM players`;

    const streams = await sql`
      SELECT COALESCE(SUM(q_attempted),0)::int AS q_attempted, COALESCE(SUM(q_correct),0)::int AS q_correct,
             COALESCE(SUM(c_attempted),0)::int AS c_attempted, COALESCE(SUM(c_correct),0)::int AS c_correct,
             COALESCE(SUM(t_attempted),0)::int AS t_attempted, COALESCE(SUM(t_correct),0)::int AS t_correct
      FROM players`;

    const territories = await sql`
      SELECT territory,
             count(*)::int AS players,
             COALESCE(SUM(total_score),0)::bigint AS points,
             COALESCE(SUM(games_played),0)::int AS games,
             COALESCE(SUM(attempted),0)::int AS attempted,
             COALESCE(SUM(correct),0)::int AS correct
      FROM players GROUP BY territory ORDER BY points DESC`;

    // 30 days of runs and points, from the event log. date_trunc in UTC is
    // fine for a chart whose x-axis is "roughly which day".
    const daily = await sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*)::int AS runs,
             COALESCE(SUM(points),0)::int AS points,
             count(DISTINCT trigram)::int AS players
      FROM score_events
      WHERE created_at > now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 ASC`;

    const top = await sql`
      SELECT trigram, territory, country_code, total_score, games_played,
             attempted, correct,
             q_attempted, q_correct, c_attempted, c_correct, t_attempted, t_correct,
             blitz_personal_high, blitz_longest_sec,
             to_char(first_seen, 'YYYY-MM-DD') AS first_seen,
             to_char(last_seen, 'YYYY-MM-DD HH24:MI') AS last_seen,
             (trigram = ANY(${EXCLUDED}::text[])) AS excluded
      FROM players ORDER BY total_score DESC`;

    const recent = await sql`
      SELECT trigram, territory, country_code, points, game,
             to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at
      FROM score_events ORDER BY id DESC LIMIT 30`;

    // Real identity for the player cards and tables — rec_roster, joined
    // per row served. Sub-wrapped: no roster, no problem.
    try {
      const tris = [...new Set([...top, ...recent].map(p => p.trigram))];
      if (tris.length) {
        const who = await sql`SELECT trigram, name, title, country, iso2 FROM rec_roster
          WHERE trigram = ANY(${tris}::text[])`;
        const byTri = Object.fromEntries(who.map(w => [w.trigram, w]));
        const tag = p => { const w = byTri[p.trigram]; if (w) { p.name = w.name; p.title = w.title; p.country = w.country; p.iso2 = w.iso2; } };
        top.forEach(tag); recent.forEach(tag);
      }
    } catch { /* roster not imported yet */ }

    // Cumulative playtime — guarded separately: the column arrives with
    // migrate and its absence must not 500 the whole dashboard.
    let playtime = 0;
    const playByTrig = {};
    try {
      const pt = await sql`SELECT trigram, COALESCE(play_seconds, 0)::bigint AS s FROM players`;
      for (const r of pt) { playByTrig[r.trigram] = Number(r.s); playtime += Number(r.s); }
    } catch { /* pre-migrate */ }
    for (const p of top) p.play_seconds = playByTrig[p.trigram] || 0;

    // Score distribution over the last 500 runs, bucketed server-side so the
    // client draws bars instead of doing math.
    const dist = await sql`
      SELECT width_bucket(points, 0, 5000, 10) AS bucket, count(*)::int AS n
      FROM (SELECT points FROM score_events ORDER BY id DESC LIMIT 500) t
      GROUP BY bucket ORDER BY bucket`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      totals: { ...totals[0], playtime },
      streams: streams[0],
      territories,
      daily,
      top,
      recent,
      distribution: dist,
      excluded: EXCLUDED,
    });
  } catch (err) {
    res.status(500).json({ error: 'Read failed', detail: String(err) });
  }
}
