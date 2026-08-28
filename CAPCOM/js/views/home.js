/* home.js — CAPCOM's landing screen. Quick actions, a recreation of the
   Mission Control calendar widget, the change feed, latest scores, and the
   questions players miss most.

   Every card degrades by scope: the calendar rebuild reads the PUBLIC feed
   (no scope needed), the change feed takes any valid key, scores need
   analytics, and the miss-rate readout takes analytics OR content. A card a
   key can't open simply doesn't render, so an SME's Home is quieter than
   the master's — by design, not by error. */
import { h, clear, fmt, isPast, esc } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';
import { ICONS } from '../icons.js';

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function render(params, rerender, who) {
  const scopes = (who && who.scopes) || [];
  const root = h('div', { class: 'view' });

  // ── quick actions ──
  const acts = [];
  const act = (icon, label, hash) => h('a', { class: 'qa', href: hash },
    h('span', { class: 'qa-ic', html: ICONS[icon] || '' }), label);
  if (scopes.includes('calendar')) acts.push(act('calendar', 'New event', '#calendar/new'));
  if (scopes.includes('banners')) {
    acts.push(act('banners', 'New hero post', '#banners/highlights/new'));
    acts.push(act('stellar', 'New Stellar post', '#banners/stellar/new'));
  }
  if (scopes.includes('content')) acts.push(act('questions', 'New question', '#questions/questions/new'));
  if (scopes.includes('system')) {
    acts.push(act('maintenance', 'Room switch', '#maintenance'));
    acts.push(act('system', 'New access key', '#system/newkey'));
  }
  if (acts.length) root.appendChild(h('div', { class: 'qa-row' }, acts));

  const grid = h('div', { class: 'grid2' });
  root.appendChild(grid);

  // ── the calendar widget, recreated ──
  const calCard = h('div', { class: 'card' }, spinner());
  grid.appendChild(calCard);
  loadCalendar(calCard, scopes);

  // ── latest changes ──
  const logCard = h('div', { class: 'card' }, spinner());
  grid.appendChild(logCard);
  loadLog(logCard);

  // ── latest scores ──
  if (scopes.includes('analytics')) {
    const scoreCard = h('div', { class: 'card' }, spinner());
    grid.appendChild(scoreCard);
    loadScores(scoreCard);
  }

  // ── most-missed questions ──
  if (scopes.includes('analytics') || scopes.includes('content')) {
    const missCard = h('div', { class: 'card' }, spinner());
    grid.appendChild(missCard);
    loadMisses(missCard, scopes);
  }

  return root;
}

/* Month grid + the next events, in the calendar page's own visual language:
   category-coloured dots on days, today ringed, past dimmed. */
async function loadCalendar(card, scopes) {
  let d;
  try { d = await api.publicEvents(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadCalendar(card, scopes))); return; }
  clear(card);

  const events = d.events || [];
  const cats = d.categories || {};
  const byDate = {};
  for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);

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
          + (+new Date(y, m, day) === +today ? ' today' : '')
          + (isPast(iso) ? ' past' : ''),
        title: evs.map(e => e.title).join(' · ') || null,
      }, String(day),
        evs.length ? h('span', { class: 'mc-dots' }, evs.slice(0, 3).map(e =>
          h('i', { style: { background: (cats[e.category] || {}).color || 'var(--muted)' } }))) : null);
      if (evs.length && scopes.includes('calendar')) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => { location.hash = '#calendar'; });
      }
      gridEl.appendChild(cell);
    }
  };
  draw();

  const upcoming = events.filter(e => !isPast(e.date)).slice(0, 3);
  clear(listEl);
  if (upcoming.length) {
    listEl.append(...upcoming.map(e => h('a', {
      class: 'mc-up', href: scopes.includes('calendar') ? '#calendar' : null,
      style: { '--evc': (cats[e.category] || {}).color || 'var(--muted)' },
    },
      h('span', { class: 'mc-up-date' }, `${e.month} ${e.day}`),
      h('span', { class: 'mc-up-title' }, e.title))));
  } else {
    listEl.appendChild(h('p', { class: 'sub' }, 'Nothing upcoming on the calendar.'));
  }

  card.append(sectionTitle('Calendar — as Mission Control shows it'), head, gridEl, listEl);
}

async function loadLog(card) {
  let d;
  try { d = await api.listLog(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadLog(card))); return; }
  clear(card);
  card.appendChild(sectionTitle('Latest changes'));
  const rows = d.log || [];
  if (!rows.length) {
    card.appendChild(emptyState('No changes recorded yet.',
      d.pending ? 'Run Setup under Access & Setup to switch the change feed on.' : 'Edits made from here will show up in this feed.'));
    return;
  }
  card.appendChild(h('div', { class: 'feed' }, rows.slice(0, 10).map(r =>
    h('div', { class: 'feed-row' },
      h('span', { class: 'feed-at' }, r.at),
      h('div', { class: 'feed-main' },
        h('span', { class: 'feed-summary' }, r.summary),
        h('span', { class: 'feed-actor' }, r.actor, ' · ', r.action))))));
}

async function loadScores(card) {
  let d;
  try { d = await api.analytics(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadScores(card))); return; }
  clear(card);
  card.appendChild(sectionTitle('Latest scores',
    h('a', { class: 'btn sm', href: '#dashboard' }, 'Dashboard')));
  const rows = (d.recent || []).slice(0, 8);
  if (!rows.length) { card.appendChild(emptyState('No runs yet.')); return; }
  card.appendChild(h('div', { class: 'feed' }, rows.map(r =>
    h('div', { class: 'feed-row' },
      h('span', { class: 'feed-at' }, r.at),
      h('div', { class: 'feed-main' },
        h('span', { class: 'feed-summary' },
          h('b', { class: 'mono' }, r.trigram), ` scored ${fmt.int(r.points)} — ${r.territory}`,
          (d.excluded || []).includes(r.trigram) ? chip('staff', 'muted') : null))))));
}

async function loadMisses(card, scopes) {
  let d;
  try { d = await api.questionStats(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadMisses(card, scopes))); return; }
  clear(card);
  card.appendChild(sectionTitle('Most-missed questions',
    scopes.includes('content') ? h('a', { class: 'btn sm', href: '#questions' }, 'Question banks') : null));

  const min = d.minAttempts || 5;
  const scored = (d.rows || []).map(r => ({
    ...r,
    missPct: r.attempted > 0 ? Math.round(100 * (r.attempted - r.correct) / r.attempted) : 0,
  }));
  const solid = scored.filter(r => r.attempted >= min && r.missPct > 0)
    .sort((a, b) => b.missPct - a.missPct || b.attempted - a.attempted).slice(0, 8);

  if (!solid.length) {
    card.appendChild(emptyState('Not enough answer data yet.',
      d.pending
        ? 'Run Setup to switch per-question tracking on — it counts every answer from then forward.'
        : `Per-question tracking is on; the readout fills in once questions have ${min}+ answers. There is no data from before tracking started.`));
    return;
  }

  card.appendChild(h('p', { class: 'sub' },
    `Miss rate on questions with at least ${min} answers — the ones worth building guidance around.`));
  card.appendChild(h('div', { class: 'miss-list' }, solid.map(r =>
    h('div', { class: 'miss-row', title: r.label },
      h('div', { class: 'miss-main' },
        h('span', { class: 'miss-label' }, r.label),
        h('span', { class: 'miss-meta' }, `${r.game} · ${r.attempted - r.correct} of ${r.attempted} missed`)),
      h('div', { class: 'miss-track' }, h('div', { class: 'miss-fill', style: { width: r.missPct + '%' } })),
      h('span', { class: 'miss-pct' }, r.missPct + '%')))));
}
