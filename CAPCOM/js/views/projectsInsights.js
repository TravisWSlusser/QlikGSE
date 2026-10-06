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
import { feedList } from '../timeline.js';
import { loadBoard, boardViewer } from '../board.js';
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
  load(root, rerender, who);
  return root;
}

async function load(root, rerender, who) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, who))); return; }
  clear(root);

  shapeProjects(d, null);
  /* The corkboard signs with a real name and matches posters to faces.
     It takes a PROMISE of the bundle, which this page already has in
     hand - so it is handed a resolved one rather than made to fetch
     the same payload a second time. */
  boardViewer({ me: (who && who.member && who.member.name) || null, people: Promise.resolve(d) });
  const teamById = d.teamById, statusById = d.statusById;
  const active = d.projects.filter(p => p.active);
  const activeStatuses = d.statuses.filter(s => s.active);

  /* ── range picker: one state, two consumers (Gantt + review) ── */
  let range = quarterRange(0);
  const fromIn = h('input', { type: 'date', value: range.from });
  const toIn = h('input', { type: 'date', value: range.to });
  const ganttCard = h('div', { class: 'card' }, spinner());

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

  /* ── ROW 1: the calendar, and everything that describes the board ──
     Travis: "Put the Calendar on the left, this new widget on the right."
     The counts, the status split and who-is-carrying-what were three
     full-width cards stacked down the page; they answer one question
     between them, so they are now one frame called Projects Overview.
     The sidebar says GSE Social; a card that repeated the page's own
     name told the reader nothing. */
  const overdue = active.filter(p => p.overdue);
  const unowned = active.filter(p => !(d.tagsByProject[p.id] || []).length);

  const byStatus = activeStatuses
    .map(x => ({ s: x, n: active.filter(p => p.status_id === x.id).length }))
    .filter(x => x.n > 0);

  const overview = h('div', { class: 'card ov-card' },
    sectionTitle('Projects Overview',
      h('span', { class: 'range-row' },
        preset('This quarter', quarterRange(0)),
        preset('Last quarter', quarterRange(-1)),
        fromIn, h('span', { class: 'sub' }, '→'), toIn)),
    // the numbers, inline and compact, directly above the split
    h('div', { class: 'ov-nums' },
      ovNum('Active', active.length),
      ovNum('Overdue', overdue.length, overdue.length ? 'bad' : 'ok'),
      ovNum('Milestones ahead', (d.milestones || []).filter(m => String(m.date) >= d.today).length),
      ovNum('Nobody tagged', unowned.length, unowned.length ? 'warn' : 'ok')),
    h('div', { class: 'ov-split' },
      byStatus.length
        ? donut(byStatus.map(x => ({
          label: x.s.label, value: x.n, colorVar: `--ps-${x.s.color}`,
          tipHtml: `<b>${esc(x.s.label)}</b><br>${x.n} project${x.n > 1 ? 's' : ''}`,
        })), { size: 124, centerLabel: String(active.length), centerSub: 'active' })
        : emptyState('Nothing active to chart.')),
    buildLoad(d, active, true));

  const row1 = h('div', { class: 'gse-row' });
  row1.append(loadCalendarCard(d, teamById, statusById), overview);
  root.appendChild(row1);

  /* ── ROW 2: the list and the timeline, side by side and LINKED ──
     Hovering a project lights its bar in the timeline and raises its
     three most recent updates. The full history is on the project page —
     Diary Review used to reprint every entry for every project here,
     which made this page long and the project page redundant. */
  const row2 = h('div', { class: 'gse-row gse-row-2' });
  const idxCard = buildIndex(d, active, statusById);
  row2.append(idxCard, ganttCard);
  root.appendChild(row2);

  /* ── ROW 3: the community half of GSE Social ──
     Both are MIRRORS, not copies: the feed is timeline.js's list shape of
     the same payload Home rotates, and the board is board.js mounted a
     second time. Change board 3 here and Home is on board 3 too, because
     it is the same board. */
  const row3 = h('div', { class: 'gse-row gse-row-3' });
  const feed = h('div', { class: 'card fd-card' }, spinner());
  const board = h('div', { class: 'card board-card' }, spinner());
  row3.append(feed, board);
  root.appendChild(row3);
  feedList(feed, sectionTitle);
  loadBoard(board, () => load(root, rerender, who));

  /* ── the range-driven redraw ── */
  const redraw = async () => {
    clear(ganttCard).appendChild(spinner());
    let rv;
    try { rv = await api.projects({ op: 'review', from: range.from, to: range.to }); }
    catch (err) {
      clear(ganttCard).appendChild(errorState(err, redraw));
      return;
    }
    buildGantt(ganttCard, d, rv, range, statusById);
    // every entry, keyed by project, for the hover card on the index
    RECENT_BY_PROJECT = {};
    for (const e of rv.entries || []) {
      (RECENT_BY_PROJECT[e.project_id] = RECENT_BY_PROJECT[e.project_id] || []).push(e);
    }
    for (const k of Object.keys(RECENT_BY_PROJECT)) {
      RECENT_BY_PROJECT[k].sort((a, z) => new Date(z.created_at) - new Date(a.created_at));
    }
  };
  redraw();
}

/* Gantt rows: walk each project's created/status_change entries in order;
   segment i runs from entry i to entry i+1 (last runs to today), colored
   by the segment's status. Clamped to the range here — gantt() only maps. */
/* Light one project's bar. The gantt rows carry data-pid so this is a
   lookup rather than a rebuild - the timeline must not redraw sixty times
   while a cursor runs down the list. */
function highlight(pid, on) {
  document.querySelectorAll(`[data-pid="${pid}"]`).forEach(el => el.classList.toggle('pid-on', on));
  const anyOn = on;
  document.querySelectorAll('.gantt-wrap').forEach(g => g.classList.toggle('gantt-focus', anyOn));
}

/* The last three updates, beside the row. One shared node, fixed
   position - the same rule as every other floating panel in CAPCOM. */
let updEl = null;
function hideUpdates() { if (updEl) updEl.style.display = 'none'; }
function showUpdates(anchor, p) {
  if (!updEl) { updEl = h('div', { id: 'upd-pop' }); document.body.appendChild(updEl); }
  const entries = (RECENT_BY_PROJECT[p.id] || []).slice(0, 3);
  clear(updEl).append(
    h('div', { class: 'upd-head' }, h('b', null, p.title),
      h('span', { class: 'sub' }, entries.length ? 'latest updates' : 'no updates in this range')),
    ...entries.map(e => h('div', { class: 'upd-row' },
      h('span', { class: 'diary-kind' }, KIND_LABEL[e.kind] || e.kind),
      e.note ? h('p', null, e.note) : null,
      h('span', { class: 'sub' }, `${e.actor} \u00b7 ${fmt.when(e.created_at)}`))),
    h('div', { class: 'upd-foot' }, 'Open the project for the full history \u2192'));
  updEl.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const w = updEl.offsetWidth, hh = updEl.offsetHeight;
  let left = r.right + 12;
  if (left + w > window.innerWidth - 8) left = r.left - w - 12;
  updEl.style.left = Math.max(8, left) + 'px';
  updEl.style.top = Math.max(8, Math.min(window.innerHeight - hh - 8, r.top)) + 'px';
}

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
      // pid pairs this bar with its row in the index beside it
      label: p.title, href: '#project/' + p.id, pid: p.id,
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

const ovNum = (label, n, tone) => h('div', { class: 'ov-num' + (tone ? ' ov-' + tone : '') },
  h('b', null, fmt.int(n)), h('span', null, label));

/* Latest diary entries per project, filled by the range redraw and read
   by the index's hover card. */
let RECENT_BY_PROJECT = {};

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
function buildLoad(d, active, inline) {
  const card = h('div', inline ? { class: 'ov-load' } : { class: 'card' });
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
    const row = h('a', { class: 'idx-row', href: '#project/' + p.id, dataset: { pid: String(p.id) } },
      h('span', { class: 'idx-title' }, p.title),
      st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
      h('span', { class: 'av-stack idx-people' }, people.slice(0, 5).map(m => avatar(m, { size: 'xs', link: false }))),
      p.overdue
        ? h('span', { class: 'overdue-badge' }, 'OVERDUE')
        : h('span', { class: 'idx-due' }, p.phase_due ? `due ${fmt.day(p.phase_due)}` : ''));
    /* Hover links the two halves of row 2: the timeline bar for this
       project lights up, and its three most recent diary entries appear
       beside the cursor. Travis asked for the timeline to react to the
       list; showing the updates here is what let Diary Review go. */
    row.addEventListener('mouseenter', () => { highlight(p.id, true); showUpdates(row, p); });
    row.addEventListener('mouseleave', () => { highlight(p.id, false); hideUpdates(); });
    row.addEventListener('focus', () => { highlight(p.id, true); showUpdates(row, p); });
    row.addEventListener('blur', () => { highlight(p.id, false); hideUpdates(); });
    return row;
  })));
  return card;
}

/* UNREACHABLE as of 29 Sep 2026. Diary Review reprinted every entry for
   every project on this page, which made GSE Social long and the project
   page redundant. The index's hover card shows the latest three and the
   project page holds the rest. Kept because it is the only grouped
   rendering of the review payload; delete it if nothing claims it. */
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
