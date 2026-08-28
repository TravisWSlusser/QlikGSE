/* players.js — the full roster table, sortable by any column. This is the
   dashboard's table view: every number, no charts. */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState, toast, confirmBox } from '../ui.js';
import { wirePop } from '../pop.js';

/* One screen, no sideways scroll: the per-stream accuracy columns folded
   into the hover card (trigram or the Accuracy value raises it), and dates
   show the day — the card carries the exact timestamps. */
const COLS = [
  ['trigram', 'Trigram', r => r.trigram],
  ['territory', 'Territory', r => r.territory],
  ['country_code', 'Country', r => (r.country_code || '').toUpperCase()],
  ['total_score', 'Points', r => fmt.int(r.total_score), true],
  ['games_played', 'Games', r => fmt.int(r.games_played), true],
  ['acc', 'Accuracy', r => fmt.pct(r.correct, r.attempted), true],
  ['blitz_personal_high', 'Best run', r => fmt.int(r.blitz_personal_high), true],
  ['blitz_longest_sec', 'Longest', r => fmt.dur(r.blitz_longest_sec), true],
  ['first_seen', 'First seen', r => r.first_seen],
  ['last_seen', 'Last seen', r => String(r.last_seen || '').slice(0, 10)],
];

function sortVal(r, key) {
  if (key === 'acc') return r.attempted > 0 ? r.correct / r.attempted : -1;
  return r[key];
}

export function render(params, rerender, who) {
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, who);
  return root;
}

async function load(root, rerender, who) {
  let d;
  try { d = await api.analytics(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, who))); return; }
  clear(root);

  let rows = (d.top || []).slice();
  let sortKey = 'total_score', sortDir = -1;
  const excluded = d.excluded || [];
  const canTag = !!(who && who.scopes && who.scopes.includes('system'));

  /* Tag or untag a player as staff — staff score privately but vanish from
     every public board. Tagging asks first; untagging is one click, since it
     only ever restores someone. */
  const staffBtn = r => {
    const isStaff = excluded.includes(r.trigram);
    return h('button', {
      class: 'btn xs' + (isStaff ? '' : ' danger'),
      onClick: () => {
        const flip = async () => {
          try {
            await api.setStaff(r.trigram, !isStaff);
            toast(isStaff ? `${r.trigram} is back on the public boards` : `${r.trigram} tagged staff — off the boards within a minute`);
            rerender();
          } catch (err) { toast(err.message, 'err'); }
        };
        if (isStaff) flip();
        else confirmBox(`Tag ${r.trigram} as staff?`,
          'They keep scoring and keep their totals, but disappear from every public leaderboard, feed and graph until untagged.',
          flip, 'Tag as staff');
      },
    }, isStaff ? 'Untag' : 'Staff');
  };

  const filterBox = h('input', {
    type: 'search', placeholder: 'Filter by trigram, territory or country…', class: 'filter',
    onInput: () => draw(),
  });
  const wrap = h('div', { class: 'table-wrap players-table' });
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
      h('thead', null, h('tr', null, [...COLS.map(([key, label]) =>
        h('th', {
          class: 'sortable' + (key === sortKey ? (sortDir < 0 ? ' desc' : ' asc') : ''),
          onClick: () => {
            if (sortKey === key) sortDir = -sortDir;
            else { sortKey = key; sortDir = -1; }
            draw();
          },
        }, label)),
        canTag ? h('th', null, 'Staff') : null].filter(Boolean))),
      h('tbody', null, shown.map(r => {
        const tds = COLS.map(([key, , get], i) =>
          h('td', { class: (i === 0 ? 'mono' : '') + (i >= 3 && i <= 7 ? ' num' : '') },
            get(r),
            i === 0 && excluded.includes(r.trigram) ? chip('staff', 'muted') : null));
        // trigram and Accuracy both raise the full stat card — the per-stream
        // bars folded from the old columns live there
        wirePop(tds[0], r, excluded);
        wirePop(tds[5], r, excluded);
        return h('tr', excluded.includes(r.trigram) ? { class: 'staff' } : null,
          tds, canTag ? h('td', null, staffBtn(r)) : null);
      }))));
  }
  draw();
}
