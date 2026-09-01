/* projectsInsights.js — the Projects group's second page: its OWN calendar
   (fully separate data from Mission Control's events), the Gantt of phase
   history, donuts by status and team, and the quarterly diary review that
   management reads to see what a quarter actually produced.

   Two calls: {op:'list'} for current state + milestones, {op:'review'}
   for the selected range's diary. The range picker redraws the Gantt and
   the review from fresh indexes — every derived structure is rebuilt
   inside the redraw (the calByDate lesson). */
import { h, clear, fmt, esc, isPast } from '../util.js';
import { api } from '../api.js';
import { sectionTitle, spinner, errorState, emptyState } from '../ui.js';
import { donut, gantt } from '../charts.js';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const KIND_LABEL = {
  created: 'Posted', status_change: 'Status', overdue_note: 'Overdue log',
  due_change: 'Date moved', update: 'Update', milestone: 'Milestone',
};
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function quarterRange(offset) {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + offset;
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { from: localIso(start), to: localIso(end) };
}

export function render(params, rerender, who) {
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender);
  return root;
}

async function load(root, rerender) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender))); return; }
  clear(root);

  const teamById = {}, statusById = {};
  for (const t of d.teams) teamById[t.id] = t;
  for (const s of d.statuses) statusById[s.id] = s;
  const active = d.projects.filter(p => p.active);
  const activeStatuses = d.statuses.filter(s => s.active);
  const activeTeams = d.teams.filter(t => t.active);

  /* ── range picker: one state, two consumers (Gantt + review) ── */
  let range = quarterRange(0);
  const fromIn = h('input', { type: 'date', value: range.from });
  const toIn = h('input', { type: 'date', value: range.to });
  const ganttCard = h('div', { class: 'card' }, spinner());
  const reviewCard = h('div', { class: 'card' }, spinner());

  const preset = (label, r) => h('button', { class: 'btn xs', onClick: () => {
    range = r; fromIn.value = r.from; toIn.value = r.to; redraw();
  } }, label);
  const applyInputs = () => {
    if (fromIn.value && toIn.value && fromIn.value <= toIn.value) {
      range = { from: fromIn.value, to: toIn.value }; redraw();
    }
  };
  fromIn.addEventListener('change', applyInputs);
  toIn.addEventListener('change', applyInputs);

  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Projects — Insights & Calendar',
      h('span', { class: 'range-row' },
        preset('This quarter', quarterRange(0)),
        preset('Last quarter', quarterRange(-1)),
        fromIn, h('span', { class: 'sub' }, '→'), toIn))));

  /* ── donuts: composition of the active board ── */
  const donutGrid = h('div', { class: 'grid2' });
  const byStatus = activeStatuses
    .map(s => ({ s, n: active.filter(p => p.status_id === s.id).length }))
    .filter(x => x.n > 0);
  const teamColor = {}; // teams cycle the same validated palette, in sort order — stable by assignment
  const PALETTE = ['violet', 'teal', 'amber', 'rose', 'blue', 'orange', 'sky'];
  activeTeams.forEach((t, i) => { teamColor[t.id] = PALETTE[i % PALETTE.length]; });
  const byTeam = activeTeams
    .map(t => ({ t, n: active.filter(p => p.team_id === t.id).length }))
    .filter(x => x.n > 0);
  donutGrid.append(
    h('div', { class: 'card' }, sectionTitle('By status'),
      byStatus.length ? donut(byStatus.map(x => ({
        label: x.s.label, value: x.n, colorVar: `--ps-${x.s.color}`,
        tipHtml: `<b>${esc(x.s.label)}</b><br>${x.n} project${x.n > 1 ? 's' : ''}`,
      })), { centerLabel: String(active.length), centerSub: 'active' })
        : emptyState('Nothing active to chart.')),
    h('div', { class: 'card' }, sectionTitle('By team'),
      byTeam.length ? donut(byTeam.map(x => ({
        label: x.t.name, value: x.n, colorVar: `--ps-${teamColor[x.t.id]}`,
        tipHtml: `<b>${esc(x.t.name)}</b><br>${x.n} project${x.n > 1 ? 's' : ''}`,
      })), { centerLabel: String(byTeam.length), centerSub: 'teams' })
        : emptyState('Nothing active to chart.')));
  root.appendChild(donutGrid);

  root.appendChild(ganttCard);

  /* ── the Projects calendar: phase deadlines + milestones, nothing else ── */
  const calCard = h('div', { class: 'card' });
  buildCalendar(calCard, d, teamById, statusById);
  root.appendChild(calCard);

  root.appendChild(reviewCard);

  /* ── the range-driven redraw ── */
  const redraw = async () => {
    clear(ganttCard).appendChild(spinner());
    clear(reviewCard).appendChild(spinner());
    let rv;
    try { rv = await api.projects({ op: 'review', from: range.from, to: range.to }); }
    catch (err) {
      clear(ganttCard).appendChild(errorState(err, redraw));
      clear(reviewCard);
      return;
    }
    buildGantt(ganttCard, d, rv, range, statusById);
    buildReview(reviewCard, rv, d, teamById, statusById, range);
  };
  redraw();
}

/* Gantt rows: walk each project's created/status_change entries in order;
   segment i runs from entry i to entry i+1 (last runs to today), colored
   by the segment's status. Clamped to the range here — gantt() only maps. */
function buildGantt(card, d, rv, range, statusById) {
  clear(card);
  const entriesByProject = {};
  for (const e of rv.entries) {
    if (e.kind === 'created' || e.kind === 'status_change') {
      (entriesByProject[e.project_id] = entriesByProject[e.project_id] || []).push(e);
    }
  }
  const projById = {};
  for (const p of d.projects) projById[p.id] = p;
  const todayIso = d.today || localIso(new Date());
  const clampEnd = range.to < todayIso ? range.to : todayIso;

  const rows = [];
  for (const p of d.projects) {
    if (!p.active) continue;
    // phase segments visible in range: use the range's diary slice; a project
    // created before the range with no changes inside it still deserves a bar,
    // so fall back to one segment at its current status spanning the range.
    const evs = entriesByProject[p.id] || [];
    const segs = [];
    const mkSeg = (startIso, endIso, statusId) => {
      const st = statusById[statusId];
      if (!st) return;
      const s = startIso < range.from ? range.from : startIso;
      const e = endIso > clampEnd ? clampEnd : endIso;
      if (s >= e) return;
      segs.push({
        startIso: s, endIso: e, colorVar: `--ps-${st.color}`,
        tipHtml: `<b>${esc(p.title)}</b><br>${esc(st.label)}<br>${fmt.day(s)} → ${fmt.day(e)}`,
      });
    };
    if (evs.length) {
      // if the first in-range event isn't 'created', the phase BEFORE it was
      // whatever that event moved from — cover the runway from range start
      if (evs[0].kind === 'status_change' && evs[0].from_status_id) {
        mkSeg(range.from, evs[0].created_at.slice(0, 10), evs[0].from_status_id);
      }
      evs.forEach((e, i) => {
        const start = e.created_at.slice(0, 10);
        const end = i + 1 < evs.length ? evs[i + 1].created_at.slice(0, 10) : clampEnd;
        mkSeg(start, end, e.to_status_id);
      });
    } else if (dateLte(p.created_at.slice(0, 10), clampEnd)) {
      mkSeg(range.from, clampEnd, p.status_id);
    }
    if (!segs.length) continue;
    rows.push({
      label: p.title, href: '#projects',
      segments: segs,
      due: {
        iso: p.phase_due, overdue: p.overdue,
        tipHtml: `<b>${esc(p.title)}</b><br>Phase due ${fmt.day(p.phase_due)}${p.overdue ? ' — <b>OVERDUE</b>' : ''}`,
      },
    });
  }

  card.appendChild(sectionTitle('Phase timeline',
    h('span', { class: 'sec-sub' }, `${fmt.day(range.from)} → ${fmt.day(range.to)}`)));
  card.appendChild(rows.length ? gantt(rows, { from: range.from, to: range.to })
    : emptyState('No project activity in this range.'));
}
const dateLte = (a, b) => a <= b;

function buildCalendar(card, d, teamById, statusById) {
  const byDate = {};
  for (const p of d.projects) {
    if (!p.active) continue;
    (byDate[p.phase_due] = byDate[p.phase_due] || []).push({
      kind: 'due', title: p.title, color: (statusById[p.status_id] || {}).color || 'blue',
      sub: `Phase due — ${(teamById[p.team_id] || {}).name || ''}`, overdue: p.overdue,
    });
  }
  for (const m of d.milestones || []) {
    (byDate[m.date] = byDate[m.date] || []).push({
      kind: 'milestone', title: m.title, color: 'sky',
      sub: `Milestone${m.detail ? ' — ' + m.detail : ''}`,
    });
  }

  let view = new Date(); view.setDate(1);
  const head = h('div', { class: 'mc-head' });
  const gridEl = h('div', { class: 'mc-grid' });
  const listEl = h('div', { class: 'mc-list' });

  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    clear(head).append(
      h('button', { class: 'btn xs', 'aria-label': 'Previous month', onClick: () => { view = new Date(y, m - 1, 1); draw(); } }, '‹'),
      h('span', { class: 'mc-month' }, `${MONTHS_LONG[m]} ${y}`),
      h('button', { class: 'btn xs', 'aria-label': 'Next month', onClick: () => { view = new Date(y, m + 1, 1); draw(); } }, '›'));
    clear(gridEl);
    for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) gridEl.appendChild(h('span', { class: 'mc-wd' }, wd));
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < first; i++) gridEl.appendChild(h('span'));
    for (let day = 1; day <= days; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const evs = byDate[iso] || [];
      const cell = h('span', {
        class: 'mc-day' + (evs.length ? ' has' : '')
          + (+new Date(y, m, day) === +today ? ' today' : '') + (isPast(iso) ? ' past' : ''),
        title: evs.map(e => e.title).join(' · ') || null,
      }, String(day),
        evs.length ? h('span', { class: 'mc-dots' }, evs.slice(0, 3).map(e =>
          h('i', { style: { background: `var(--ps-${e.color})` } }))) : null);
      if (evs.length) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => showDay(iso, evs));
      }
      gridEl.appendChild(cell);
    }
  };
  const showDay = (iso, evs) => {
    clear(listEl).append(
      h('p', { class: 'sub', style: { marginBottom: '6px' } }, fmt.day(iso)),
      ...evs.map(e => h('div', { class: 'mc-up', style: { '--evc': `var(--ps-${e.color})` } },
        h('span', { class: 'mc-up-date' }, e.kind === 'due' ? 'DUE' : 'MILE'),
        h('span', { class: 'mc-up-title' }, `${e.title} — ${e.sub}`,
          e.overdue ? h('span', { class: 'overdue-badge', style: { marginLeft: '8px' } }, 'OVERDUE') : null))));
  };
  draw();

  // the default list: the next few deadlines/milestones from today forward
  const upcoming = Object.keys(byDate).sort().filter(iso => !isPast(iso))
    .flatMap(iso => byDate[iso].map(e => ({ iso, ...e }))).slice(0, 4);
  clear(listEl).append(...(upcoming.length
    ? upcoming.map(e => h('div', { class: 'mc-up', style: { '--evc': `var(--ps-${e.color})` } },
      h('span', { class: 'mc-up-date' }, fmt.day(e.iso)),
      h('span', { class: 'mc-up-title' }, `${e.title} — ${e.sub}`)))
    : [h('p', { class: 'sub' }, 'Nothing on the projects calendar yet.')]));

  card.append(
    sectionTitle('Projects calendar', h('span', { class: 'sec-sub' }, 'phase deadlines + milestones — separate from Mission Control')),
    head, gridEl, listEl);
}

/* the quarter's diary, grouped per project — deliberately print-shaped */
function buildReview(card, rv, d, teamById, statusById, range) {
  clear(card);
  card.appendChild(sectionTitle('Diary review',
    h('span', { class: 'sec-sub' }, `every log entry, ${fmt.day(range.from)} → ${fmt.day(range.to)}`)));
  if (!rv.entries.length) {
    card.appendChild(emptyState('No project activity in this range.'));
    return;
  }
  const byProject = {};
  for (const e of rv.entries) (byProject[e.project_id] = byProject[e.project_id] || []).push(e);
  for (const p of rv.projects) {
    const evs = byProject[p.id] || [];
    if (!evs.length) continue;
    card.appendChild(h('div', { class: 'rv-project' },
      h('div', { class: 'rv-head' },
        h('span', { class: 'prj-title' + (p.active ? '' : ' prj-retired') }, p.title),
        h('span', { class: 'rv-team' }, (teamById[p.team_id] || {}).name || ''),
        h('span', { class: 'rv-team' }, `${evs.length} entr${evs.length > 1 ? 'ies' : 'y'}`)),
      h('div', { class: 'rv-entries' }, evs.map(e => {
        const to = e.to_status_id && statusById[e.to_status_id];
        return h('div', null,
          h('span', { class: 'diary-kind' + (e.kind === 'overdue_note' ? ' overdue' : '') }, KIND_LABEL[e.kind] || e.kind),
          to ? h('span', { style: { fontSize: '.8rem' } },
            h('span', { class: 'diary-dot', style: { background: `var(--ps-${to.color})` } }), to.label,
            e.phase_due ? ` · due ${fmt.day(e.phase_due)}` : '') : null,
          e.note ? h('div', { class: 'diary-note' }, e.note) : null,
          h('div', { class: 'diary-meta' }, `${e.actor} · ${fmt.when(e.created_at)}`));
      }))));
  }
}
