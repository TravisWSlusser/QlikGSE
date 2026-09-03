import { sql, requireScope, cors, parseBody } from './auth.js';
import { getSecret } from '../secrets.js';

/*
  POST /api/admin/brief — the Leadership Brief: what Sales Enablement
  shipped, moved, and promised over a window, compiled for Nick and
  Mike to carry upward.

  { op:'digest', window:'week'|'month'|'quarter' }
    → FACTS, straight from the database. Deterministic on purpose: the
      numbers leadership repeats must never be hallucinated. Includes
      movement, milestones hit and upcoming, overdue (with the written
      what-happened notes), new projects, and LULLS — projects and
      teams with zero recorded activity in the window.

  { op:'narrate', window }
    → the same digest handed to Claude for a 2–3 paragraph executive
      summary. Requires ANTHROPIC_API_KEY in Keys & Services (or the
      Vercel env). Cached 6h per window in api_cache so a re-click is
      free; the digest itself is always live. Claude sees the COMPILED
      digest only — never raw database access.

  Projects scope (managers hold it; plain member sessions do not).
*/
const WINDOWS = { week: 7, month: 30, quarter: 91 };

async function buildDigest(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const ahead = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const projects = await sql`SELECT p.id, p.title, p.status_id, p.phase_due, p.created_at, p.active,
      t.name AS team, s.label AS status
    FROM projects p
    LEFT JOIN project_teams t ON t.id = p.team_id
    LEFT JOIN project_statuses s ON s.id = p.status_id`;
  const log = await sql`SELECT l.project_id, l.kind, l.note, l.actor, l.created_at,
      fs.label AS from_status, ts.label AS to_status
    FROM project_log l
    LEFT JOIN project_statuses fs ON fs.id = l.from_status_id
    LEFT JOIN project_statuses ts ON ts.id = l.to_status_id
    WHERE l.created_at >= ${since} ORDER BY l.created_at`;
  const hit = await sql`SELECT m.date, m.title, p.title AS project FROM project_milestones m
    JOIN projects p ON p.id = m.project_id
    WHERE m.active = true AND p.active = true AND m.date >= ${since.slice(0, 10)} AND m.date <= ${today}
    ORDER BY m.date`;
  const upcoming = await sql`SELECT m.date, m.title, p.title AS project FROM project_milestones m
    JOIN projects p ON p.id = m.project_id
    WHERE m.active = true AND p.active = true AND m.date > ${today} AND m.date <= ${ahead}
    ORDER BY m.date LIMIT 12`;

  const byId = {}; for (const p of projects) byId[p.id] = p;
  const active = projects.filter(p => p.active);
  const touched = new Set(log.map(l => l.project_id));

  const moved = log.filter(l => l.kind === 'status').map(l => ({
    project: (byId[l.project_id] || {}).title || '?', team: (byId[l.project_id] || {}).team || '',
    from: l.from_status, to: l.to_status, when: l.created_at, note: (l.note || '').slice(0, 200),
  }));
  const overdueNow = active.filter(p => p.phase_due && String(p.phase_due).slice(0, 10) < today)
    .map(p => ({ project: p.title, team: p.team, status: p.status, due: String(p.phase_due).slice(0, 10) }));
  const overdueNotes = log.filter(l => (l.kind === 'status' || l.kind === 'extend') && l.note)
    .map(l => ({ project: (byId[l.project_id] || {}).title || '?', kind: l.kind, note: l.note.slice(0, 240), actor: l.actor }));
  const fresh = active.filter(p => p.created_at >= since)
    .map(p => ({ project: p.title, team: p.team, status: p.status, due: p.phase_due ? String(p.phase_due).slice(0, 10) : null }));
  const lulls = active.filter(p => !touched.has(p.id))
    .map(p => ({ project: p.title, team: p.team, status: p.status, due: p.phase_due ? String(p.phase_due).slice(0, 10) : null }));
  const activeTeams = [...new Set(active.map(p => p.team).filter(Boolean))];
  const quietTeams = activeTeams.filter(t =>
    !log.some(l => (byId[l.project_id] || {}).team === t));
  const diary = log.filter(l => l.kind === 'note' && l.note)
    .map(l => ({ project: (byId[l.project_id] || {}).title || '?', note: l.note.slice(0, 240), actor: l.actor, when: l.created_at }));

  return {
    generated: new Date().toISOString(), days,
    counts: { active: active.length, moved: moved.length, overdue: overdueNow.length, new: fresh.length, lulls: lulls.length },
    moved, milestonesHit: hit.map(m => ({ date: String(m.date).slice(0, 10), title: m.title, project: m.project })),
    milestonesUpcoming: upcoming.map(m => ({ date: String(m.date).slice(0, 10), title: m.title, project: m.project })),
    overdueNow, overdueNotes, newProjects: fresh, lulls, quietTeams, diary,
  };
}

const WINDOW_LABEL = { week: 'the past week', month: 'the past month', quarter: 'the past quarter' };

async function narrate(digest, windowName) {
  const key = await getSecret('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'No ANTHROPIC_API_KEY — add it under Maintenance → Keys & Services' };
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    system: 'You write executive summaries for a Sales Enablement leadership team at Qlik. '
      + 'You are given a compiled activity digest (facts only — do not invent numbers, projects, or names). '
      + 'Write 2–3 tight paragraphs a department head could paste into an update to their own leadership: '
      + 'lead with concrete wins and movement, name key projects and milestones, frame overdue items with their '
      + 'written explanations honestly but constructively, and note quiet areas (lulls) as attention items, not accusations. '
      + 'No headings, no bullet lists, no preamble — just the prose. Plain text.',
    messages: [{
      role: 'user',
      content: `Window: ${WINDOW_LABEL[windowName] || windowName}.\n\nDigest:\n${JSON.stringify(digest, null, 1)}`,
    }],
  });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (response.stop_reason === 'refusal' || !text) return { ok: false, error: 'The model declined — the facts view above still stands' };
  return { ok: true, text };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'projects');
  if (!who) return;
  // Travis: the Leadership Brief is for the CORE LEADERSHIP TEAM — the
  // manager tier he named (Nick, Mike, Steve, Eric, Rafael, Barb, him) —
  // plus masters. Not scoped keys, not plain members, and not tied to the
  // people-leader flag (Barb, Eric and Travis lead no reports but are
  // core leadership).
  if (!who.master && !who.manager) {
    return res.status(403).json({ error: 'The Leadership Brief is for the leadership team' });
  }

  const b = parseBody(req);
  const op = (b.op || '').toString();
  const windowName = WINDOWS[b.window] ? b.window : 'week';
  const days = WINDOWS[windowName];

  try {
    if (op === 'digest') {
      const digest = await buildDigest(days);
      const ai_ready = !!(await getSecret('ANTHROPIC_API_KEY'));
      return res.status(200).json({ ok: true, window: windowName, digest, ai_ready });
    }

    if (op === 'narrate') {
      // 6h cache per window — a re-click should not re-bill
      const ck = `brief_${windowName}`;
      try {
        const c = await sql`SELECT payload, EXTRACT(EPOCH FROM (now() - fetched_at))/60 AS age
          FROM api_cache WHERE key = ${ck} LIMIT 1`;
        if (c.length && Number(c[0].age) < 360 && c[0].payload && c[0].payload.text) {
          return res.status(200).json({ ok: true, window: windowName, text: c[0].payload.text, cached: true });
        }
      } catch { /* no cache table yet — narrate live */ }
      const digest = await buildDigest(days);
      const r = await narrate(digest, windowName);
      if (!r.ok) return res.status(503).json({ error: r.error });
      try {
        await sql`INSERT INTO api_cache (key, payload, fetched_at)
          VALUES (${ck}, ${JSON.stringify({ text: r.text })}::jsonb, now())
          ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`;
      } catch { /* cache is a courtesy */ }
      return res.status(200).json({ ok: true, window: windowName, text: r.text });
    }

    res.status(400).json({ error: 'Bad op', ops: ['digest', 'narrate'] });
  } catch (err) {
    res.status(500).json({ error: 'Brief failed — has Setup been run?', detail: String(err) });
  }
}
