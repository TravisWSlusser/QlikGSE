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
import { avatar } from '../avatar.js';
import { shapeProjects } from './projects.js';
import { sectionTitle, spinner, errorState, emptyState } from '../ui.js';
import { donut, gantt, statTile } from '../charts.js';

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

  shapeProjects(d, null);
  const teamById = d.teamById, statusById = d.statusById;
  const active = d.projects.filter(p => p.active);
  const activeStatuses = d.statuses.filter(s => s.active);

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

  /* ── the strip: the four numbers, the range picker, nothing else ──
     This page was six full-width cards deep before anything told you how
     the board was actually doing. The counts come first now, and the
     range picker rides with them instead of owning a card of its own. */
  const overdue = active.filter(p => p.overdue);
  const unowned = active.filter(p => !(d.tagsByProject[p.id] || []).length);
  root.appendChild(h('div', { class: 'card gse-head' },
    sectionTitle('GSE Central',
      h('span', { class: 'range-row' },
        preset('This quarter', quarterRange(0)),
        preset('Last quarter', quarterRange(-1)),
        fromIn, h('span', { class: 'sub' }, '→'), toIn)),
    h('div', { class: 'tiles tiles-4' },
      statTile('Active', fmt.int(active.length)),
      statTile('Overdue', fmt.int(overdue.length),
        overdue.length ? 'past their promise' : 'all promises holding'),
      statTile('Milestones ahead', fmt.int((d.milestones || []).filter(m => String(m.date) >= d.today).length)),
      statTile('Nobody tagged', fmt.int(unowned.length),
        unowned.length ? 'no one is on these' : 'every project has people'))));

  /* ── composition + the calendar, side by side ──
     "By team" is GONE. The enablement org has no named sub-teams - who
     reports to whom is the Staff page's job, and everyone ends up on
     everything. Charting a structure that does not drive the work made
     the page look analytical while saying nothing. What replaced it is
     the split that does drive the work: who is carrying how much. */
  const byStatus = activeStatuses
    .map(s => ({ s, n: active.filter(p => p.status_id === s.id).length }))
    .filter(x => x.n > 0);
  const topRow = h('div', { class: 'grid2' });
  topRow.append(
    h('div', { class: 'card' }, sectionTitle('By status'),
      byStatus.length ? donut(byStatus.map(x => ({
        label: x.s.label, value: x.n, colorVar: `--ps-${x.s.color}`,
        tipHtml: `<b>${esc(x.s.label)}</b><br>${x.n} project${x.n > 1 ? 's' : ''}`,
      })), { centerLabel: String(active.length), centerSub: 'active' })
        : emptyState('Nothing active to chart.')),
    loadCalendarCard(d, teamById, statusById));
  root.appendChild(topRow);

  /* ── who is on what ── person level, not team level ── */
  root.appendChild(buildLoad(d, active));

  /* ── every project, one line each, each one a door ── */
  root.appendChild(buildIndex(d, active, statusById));

  root.appendChild(ganttCard);
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

function loadCalendarCard(d, teamById, statusById) {
  const card = h('div', { class: 'card' });
  buildCalendar(card, d, teamById, statusById);
  return card;
}

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

/* ── Who is carrying what ──
 *
 * The Team Member Catalog used to sit here, grouping people under team
 * names. Travis: the enablement org has no separate internal teams, the
 * reporting line is the Staff page's job, and everyone ends up working on
 * everything — so a catalog by team was a structure nobody works by.
 *
 * This is the question that survives it: who is on how much, and is
 * anyone carrying more than they should. Person level, ordered by load,
 * every face a door to that person and every project a door to itself.
 */
function buildLoad(d, active) {
  const card = h('div', { class: 'card' });
  const rows = (d.members || [])
    .filter(m => m.active)
    .map(m => ({
      m,
      projects: (d.tagsByMember[m.id] || [])
        .map(id => d.projectById[id])
        .filter(p => p && p.active),
    }))
    .filter(x => x.projects.length)
    .sort((a, b) => b.projects.length - a.projects.length || a.m.name.localeCompare(b.m.name));

  const idle = (d.members || []).filter(m => m.active
    && !(d.tagsByMember[m.id] || []).some(id => (d.projectById[id] || {}).active));

  card.appendChild(sectionTitle('Who is on what',
    h('span', { class: 'sec-sub' }, `${rows.length} of ${rows.length + idle.length} people carrying ${active.length} projects`)));

  if (!rows.length) {
    card.appendChild(emptyState('Nobody is tagged on an active project.',
      'Tag people from a project on the board and they show up here.'));
    return card;
  }

  const most = rows[0].projects.length;
  card.appendChild(h('div', { class: 'load-list' }, rows.map(({ m, projects }) =>
    h('div', { class: 'load-row' },
      avatar(m, { size: 'sm' }),
      h('span', { class: 'load-name' }, m.name),
      h('span', { class: 'load-bar' },
        h('i', { style: { width: Math.max(6, 100 * projects.length / most) + '%' } })),
      h('span', { class: 'load-n' }, String(projects.length)),
      h('span', { class: 'load-projects' }, projects.map(p =>
        h('a', { class: 'load-chip', href: '#project/' + p.id, title: p.title }, p.title)))))));

  /* The unassigned, as FACES rather than a sentence.
     On the rig this was one name and a comma list read fine. In
     production it is 14 of 16 people - the team runs two active projects -
     and a paragraph of names is both a wall of text and faintly
     accusatory. A stack of faces states the same fact without reading
     like a list of who is idle, and each one still names itself on hover
     and opens that person. */
  if (idle.length) {
    card.appendChild(h('div', { class: 'load-idle' },
      h('span', { class: 'load-idle-lbl' },
        `Not on an active project · ${idle.length}`),
      h('span', { class: 'av-stack' }, idle.map(m => avatar(m, { size: 'xs' })))));
  }
  return card;
}

/* ── the index: every active project, one line, each a door ──
   The page had no list of the projects it was charting. You read four
   visualisations OF the board without ever seeing the board. */
function buildIndex(d, active, statusById) {
  const card = h('div', { class: 'card' });
  const rows = active.slice().sort((a, b) =>
    (b.overdue - a.overdue) || String(a.phase_due || '').localeCompare(String(b.phase_due || '')));
  card.appendChild(sectionTitle('Projects',
    h('a', { class: 'btn xs', href: '#projects' }, 'Open the board \u2192')));
  if (!rows.length) { card.appendChild(emptyState('Nothing active.')); return card; }
  card.appendChild(h('div', { class: 'idx-list' }, rows.map(p => {
    const st = statusById[p.status_id];
    const people = (d.tagsByProject[p.id] || []).map(id => d.memberById[id]).filter(Boolean);
    return h('a', { class: 'idx-row', href: '#project/' + p.id },
      h('span', { class: 'idx-title' }, p.title),
      st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
      h('span', { class: 'av-stack idx-people' }, people.slice(0, 5).map(m => avatar(m, { size: 'xs', link: false }))),
      p.overdue
        ? h('span', { class: 'overdue-badge' }, 'OVERDUE')
        : h('span', { class: 'idx-due' }, p.phase_due ? `due ${fmt.day(p.phase_due)}` : ''));
  })));
  return card;
}

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
