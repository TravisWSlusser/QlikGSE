/* players.js — the full roster table, sortable by any column. This is the
   dashboard's table view: every number, no charts. */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

const COLS = [
  ['trigram', 'Trigram', r => r.trigram],
  ['territory', 'Territory', r => r.territory],
  ['country_code', 'Country', r => (r.country_code || '').toUpperCase()],
  ['total_score', 'Points', r => fmt.int(r.total_score), true],
  ['games_played', 'Games', r => fmt.int(r.games_played), true],
  ['acc', 'Accuracy', r => fmt.pct(r.correct, r.attempted), true],
  ['q', 'Knowledge', r => fmt.pct(r.q_correct, r.q_attempted), true],
  ['c', 'Methodology', r => fmt.pct(r.c_correct, r.c_attempted), true],
  ['t', 'Glossary', r => fmt.pct(r.t_correct, r.t_attempted), true],
  ['blitz_personal_high', 'Best run', r => fmt.int(r.blitz_personal_high), true],
  ['blitz_longest_sec', 'Longest', r => fmt.dur(r.blitz_longest_sec), true],
  ['first_seen', 'First seen', r => r.first_seen],
  ['last_seen', 'Last seen', r => r.last_seen],
];

function sortVal(r, key) {
  if (key === 'acc') return r.attempted > 0 ? r.correct / r.attempted : -1;
  if (key === 'q') return r.q_attempted > 0 ? r.q_correct / r.q_attempted : -1;
  if (key === 'c') return r.c_attempted > 0 ? r.c_correct / r.c_attempted : -1;
  if (key === 't') return r.t_attempted > 0 ? r.t_correct / r.t_attempted : -1;
  return r[key];
}

export function render(params, rerender) {
  const root = h('div', { class: 'view' }, spinner());
  load(root);
  return root;
}

async function load(root) {
  let d;
  try { d = await api.analytics(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root))); return; }
  clear(root);

  let rows = (d.top || []).slice();
  let sortKey = 'total_score', sortDir = -1;
  const excluded = d.excluded || [];

  const filterBox = h('input', {
    type: 'search', placeholder: 'Filter by trigram, territory or country…', class: 'filter',
    onInput: () => draw(),
  });
  const wrap = h('div', { class: 'table-wrap' });
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Players — top 50 by lifetime points', filterBox), wrap));

  function draw() {
    const q = filterBox.value.trim().toUpperCase();
    const shown = rows
      .filter(r => !q || r.trigram.includes(q) || (r.territory || '').includes(q)
        || (r.country_code || '').toUpperCase().includes(q))
      .sort((a, b) => {
        const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
        return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
      });
    clear(wrap);
    if (!shown.length) { wrap.appendChild(emptyState('Nobody matches that filter.')); return; }
    wrap.appendChild(h('table', null,
      h('thead', null, h('tr', null, COLS.map(([key, label]) =>
        h('th', {
          class: 'sortable' + (key === sortKey ? (sortDir < 0 ? ' desc' : ' asc') : ''),
          onClick: () => {
            if (sortKey === key) sortDir = -sortDir;
            else { sortKey = key; sortDir = -1; }
            draw();
          },
        }, label)))),
      h('tbody', null, shown.map(r => h('tr', excluded.includes(r.trigram) ? { class: 'staff' } : null,
        COLS.map(([key, , get], i) =>
          h('td', { class: (i === 0 ? 'mono' : '') + (i >= 3 && i <= 10 ? ' num' : '') },
            get(r),
            i === 0 && excluded.includes(r.trigram) ? chip('staff', 'muted') : null)))))));
  }
  draw();
}
