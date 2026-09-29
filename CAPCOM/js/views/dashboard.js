/* dashboard.js — the REC Room scoreboard.
 *
 * This page used to be half analytics report and half systems check. The
 * systems board moved to MT Roster, which is now the health page; what is
 * left here answers one question for the enablement team: who is winning,
 * what is their NAME, and what is every territory doing.
 *
 * Names are the point. The board ranked trigrams and hid the person in a
 * hover card, which is fine for the arcade screen in the room and useless
 * in a meeting - "SKJ is up" is not a sentence anyone can act on. The
 * analytics payload has joined rec_roster onto every player and every run
 * since the roster import, so the name was already on the wire; it just was
 * not on screen.
 *
 * One /api/admin/analytics call feeds everything (the BRUCE /api/state
 * pattern), re-pulled every 60s while the tab is VISIBLE. Backgrounded, it
 * stops dead: an admin page polling from a forgotten tab is how a Neon
 * compute gets held awake all night for nobody.
 */
import { h, clear, fmt, esc } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState, toast, confirmBox } from '../ui.js';
import { statTile, hbars, columns } from '../charts.js';
import { wirePop } from '../pop.js';
import { recMap, TERR_COLOR } from '../recmap.js';

const REFRESH_MS = 60_000;

/* seconds → "34h 12m" (or "48m" under an hour) */
const fmtPlay = s => {
  s = Number(s || 0);
  const hrs = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return hrs ? `${fmt.int(hrs)}h ${min}m` : `${min}m`;
};

const STREAMS = [
  ['Knowledge', 'q_attempted', 'q_correct', 'Brain Freeze questions'],
  ['Methodology', 'c_attempted', 'c_correct', 'Coin questions (Madness)'],
  ['Glossary', 't_attempted', 't_correct', 'Brain Blast terms'],
];

const TERRITORIES = ['NAM', 'LATAM', 'EMEA', 'APAC'];

/* A run's identity, for spotting what is NEW between two polls. score_events
   has an id but analytics does not serve it, so the tuple stands in — a
   genuine duplicate (same trigram, same points, same minute) is one burst
   instead of two, which nobody will ever notice. */
const runKey = r => `${r.trigram}|${r.points}|${r.at}`;

/* The person, for a board a room full of people reads. Falls back to the
   trigram, because a scoring trigram with no roster row is a real state —
   see MT Roster, which exists partly to surface exactly those. */
const who = p => p.name || p.trigram;

export function render(params, rerender, viewer) {
  const root = h('div', { class: 'view' }, spinner());
  const st = { map: null, seen: null, timer: null, dead: false };

  const tick = async () => {
    if (st.dead || !root.isConnected) return stop();
    if (document.visibilityState !== 'visible') return;      // paused, not stopped
    // Don't yank the page out from under someone mid-keystroke: a rebuild
    // drops focus, and the filter box is the one thing here people type in.
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT' && root.contains(a)) return;
    try { paint(root, await api.analytics(), st, rerender, viewer); }
    catch { /* a failed refresh keeps the last good board on screen */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') tick(); };
  const stop = () => {
    st.dead = true;
    clearInterval(st.timer);
    document.removeEventListener('visibilitychange', onVis);
    if (st.map) st.map.stop();
  };

  (async () => {
    let d;
    try { d = await api.analytics(); }
    catch (err) { clear(root).appendChild(errorState(err, () => rerender())); return; }
    if (!root.isConnected) return;
    paint(root, d, st, rerender, viewer);
    st.timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', onVis);
  })();

  return root;
}

function paint(root, d, st, rerender, viewer) {
  // A refresh redraws the board but must NOT rebuild the map: clear(root)
  // only detaches it, so the same element is re-appended below with its
  // in-flight bubbles intact.
  if (!st.map) st.map = recMap();

  const excluded = d.excluded || [];
  // Podiums and the leaderboard rank the ORG: no zero-point roster ghosts,
  // no staff. Staff stay visible, flagged, in the full table below.
  const ranked = (d.top || [])
    .filter(p => Number(p.total_score) > 0 && !excluded.includes(p.trigram));

  // New runs since the last poll, held until the map is on the page — see
  // the note at the bottom of this function.
  const fires = st.seen
    ? (d.recent || []).slice().reverse().filter(r => !st.seen.has(runKey(r)))
    : [];
  st.seen = new Set((d.recent || []).map(runKey));

  const stamp = h('span', { class: 'sec-sub live-stamp' },
    h('i', { class: 'live-dot' }), 'live · ' + new Date().toLocaleTimeString());

  clear(root);

  // ── the numbers everyone quotes ──
  root.appendChild(h('div', { class: 'tiles tiles-5' },
    statTile('Players', fmt.int((d.totals || {}).players)),
    statTile('Games played', fmt.int((d.totals || {}).games)),
    statTile('Points scored', fmt.int((d.totals || {}).points)),
    statTile('Total playtime', fmtPlay((d.totals || {}).playtime),
      'across every player — counting since 28 Aug'),
    statTile('Answer accuracy', fmt.pct((d.totals || {}).correct, (d.totals || {}).attempted),
      `${fmt.int((d.totals || {}).correct)} of ${fmt.int((d.totals || {}).attempted)} answers`)));

  // ── the map, with the standings beside it ──
  const totalPts = (d.territories || []).reduce((n, t) => n + Number(t.points || 0), 0) || 1;
  root.appendChild(h('div', { class: 'card map-card' },
    sectionTitle('Territory standings', stamp),
    h('div', { class: 'map-row' },
      st.map.el,
      h('div', { class: 'terr-list' }, (d.territories || []).map((t, i) => {
        const key = String(t.territory || '').toLowerCase();
        return h('div', { class: 'terr-row', style: { '--terr': TERR_COLOR[key] || 'var(--muted)' } },
          h('span', { class: 'terr-rank' }, ['🥇', '🥈', '🥉'][i] || String(i + 1)),
          h('span', { class: 'terr-name' }, t.territory || '—'),
          h('div', { class: 'terr-bar' },
            h('div', { class: 'terr-fill', style: { width: Math.max(2, 100 * Number(t.points) / totalPts) + '%' } })),
          h('span', { class: 'terr-pts num' }, fmt.int(t.points)),
          h('span', { class: 'terr-sub' },
            `${fmt.int(t.players)} players · ${fmt.pct(t.correct, t.attempted)}`));
      })))));

  // ── the leaderboard, by name ──
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Leaderboard', h('span', { class: 'sec-sub' }, 'worldwide, lifetime points')),
    ranked.length
      ? h('div', { class: 'lb' }, ranked.slice(0, 10).map((p, i) => {
        const row = h('div', { class: 'lb-row r' + (i + 1) },
          h('span', { class: 'lb-rank' }, ['🥇', '🥈', '🥉'][i] || String(i + 1)),
          h('span', { class: 'lb-who' },
            h('b', null, who(p)),
            h('span', { class: 'lb-meta' },
              p.title ? p.title : 'no roster match',
              p.country ? ' · ' + p.country : '')),
          h('span', { class: 'lb-trig mono' }, p.trigram),
          h('span', { class: 'lb-terr', style: { '--terr': TERR_COLOR[String(p.territory || '').toLowerCase()] || 'var(--muted)' } },
            p.territory || '—'),
          h('span', { class: 'lb-acc sub' }, fmt.pct(p.correct, p.attempted)),
          h('span', { class: 'lb-pts num' }, fmt.int(p.total_score)));
        wirePop(row, p, excluded);
        return row;
      }))
      : emptyState('Nobody has scored yet.')));

  // ── per-territory podiums, also by name ──
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Top of each territory'),
    h('div', { class: 'gm-grid' }, TERRITORIES.map(terr => {
      const col = h('div', { class: 'gm-col' }, h('h3', { class: 'ss-h ' + terr.toLowerCase() }, terr));
      const rows = ranked.filter(p => p.territory === terr).slice(0, 3);
      if (!rows.length) { col.appendChild(h('p', { class: 'sub' }, 'Nobody yet.')); return col; }
      col.appendChild(h('div', { class: 'gm-list' }, rows.map((p, i) => {
        const row = h('div', { class: 'gm-row' },
          h('span', { class: 'gm-rank r' + (i + 1) }, ['🥇', '🥈', '🥉'][i] || String(i + 1)),
          // the trigram only follows a NAME — without one, who() already
          // printed the trigram and "JAE JAE" reads as a rendering bug
          h('span', { class: 'gm-who' }, who(p),
            p.name ? h('i', { class: 'mono' }, p.trigram) : null),
          h('span', { class: 'gm-pts num' }, fmt.int(p.total_score)));
        wirePop(row, p, excluded);
        return row;
      })));
      return col;
    }))));

  // ── the live feed ──
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Latest runs', h('span', { class: 'sec-sub' }, 'newest first')),
    h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null,
          ['When', 'Player', 'Trigram', 'Territory', 'Game', 'Points'].map(x => h('th', null, x)))),
        h('tbody', null, (d.recent || []).slice(0, 15).map(r =>
          h('tr', null,
            h('td', { class: 'mono sub' }, r.at),
            h('td', null, who(r), r.title ? h('span', { class: 'sub' }, ' · ' + r.title) : null),
            h('td', { class: 'mono' }, r.trigram,
              excluded.includes(r.trigram) ? chip('staff', 'muted') : null),
            h('td', null, r.territory),
            h('td', { class: 'sub' }, r.game || '—'),
            h('td', { class: 'num' }, fmt.int(r.points)))))))));

  // ── every player, every column ──
  root.appendChild(playerTable(d, st, rerender, viewer));

  // ── the shape of play ──
  const daily = (d.daily || []).map(r => ({
    label: fmt.day(r.day),
    value: r.runs,
    tipHtml: `<b>${fmt.day(r.day)}</b><br>${fmt.int(r.runs)} runs · ${fmt.int(r.points)} pts · ${fmt.int(r.players)} players`,
  }));
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Runs per day — last 30 days'),
    daily.length ? columns(daily) : h('p', { class: 'sub' }, 'No runs recorded in the last 30 days.')));

  const grid = h('div', { class: 'grid2' });
  root.appendChild(grid);

  const s = d.streams || {};
  grid.appendChild(h('div', { class: 'card' },
    sectionTitle('Accuracy by learning stream'),
    hbars(STREAMS.map(([name, a, c, what]) => ({
      label: name,
      value: s[a] > 0 ? 100 * s[c] / s[a] : 0,
      display: fmt.pct(s[c], s[a]),
      tipHtml: `<b>${name}</b> — ${esc(what)}<br>${fmt.int(s[c])} correct of ${fmt.int(s[a])} attempted`,
    })), { max: 100 })));

  const buckets = d.distribution || [];
  const rows = [];
  for (let b = 1; b <= 10; b++) {
    const hit = buckets.find(x => Number(x.bucket) === b);
    const lo = (b - 1) * 500, hi = b * 500;
    rows.push({ label: String(lo), value: hit ? hit.n : 0, tipHtml: `<b>${lo}–${hi} pts</b><br>${hit ? fmt.int(hit.n) : 0} runs` });
  }
  const over = buckets.find(x => Number(x.bucket) === 11); // width_bucket: >= max lands in 11
  if (over) rows.push({ label: '5000+', value: over.n, tipHtml: `<b>5000+ pts</b><br>${fmt.int(over.n)} runs` });
  grid.appendChild(h('div', { class: 'card' },
    sectionTitle('Score spread — last 500 runs'),
    buckets.length ? columns(rows, { height: 120 }) : h('p', { class: 'sub' }, 'No runs yet.')));

  /* LAST, and it has to be last. The pins and bursts are placed in PANEL
     pixels, mapped through the masks' contain/center fit — so the panel has
     to have a size, which it does not until it is in the document. Painting
     before the append put every pin in the top-left corner, which is the
     same trap the room's fx canvas fell into at its intrinsic 300x150. */
  st.map.paint(d.territories);
  fires.forEach((r, i) => setTimeout(
    () => st.map.burst(r.territory, r.points, who(r)), 400 * i));
}

/* ── the full table, moved here from MT Roster ──
   "See ALL the scoring data easily" is this: every column, sortable, one
   filter box. Name leads now; the trigram follows it. */
const COLS = [
  ['name', 'Player', r => r.name || '—'],
  ['trigram', 'Trigram', r => r.trigram],
  ['title', 'Title', r => r.title || '—'],
  ['territory', 'Territory', r => r.territory],
  ['country_code', 'Country', r => r.country || (r.country_code || '').toUpperCase()],
  ['total_score', 'Points', r => fmt.int(r.total_score), true],
  ['games_played', 'Games', r => fmt.int(r.games_played), true],
  ['acc', 'Accuracy', r => fmt.pct(r.correct, r.attempted), true],
  ['blitz_personal_high', 'Best run', r => fmt.int(r.blitz_personal_high), true],
  ['blitz_longest_sec', 'Longest', r => fmt.dur(r.blitz_longest_sec), true],
  ['last_seen', 'Last seen', r => String(r.last_seen || '').slice(0, 10)],
];
const NUM_FROM = 5, NUM_TO = 9;

function sortVal(r, key) {
  if (key === 'acc') return r.attempted > 0 ? r.correct / r.attempted : -1;
  return r[key];
}

function playerTable(d, st, rerender, viewer) {
  const rows = (d.top || []).slice();
  const excluded = d.excluded || [];
  const canTag = !!(viewer && viewer.scopes && viewer.scopes.includes('system'));
  /* Sort and filter live on `st`, not in this closure. The board rebuilds
     itself every 60 seconds, and a table that silently re-sorted itself and
     emptied the filter box while someone was reading it would make the live
     refresh worse than no refresh. */
  const tbl = st.table || (st.table = { key: 'total_score', dir: -1, q: '' });

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
    type: 'search', placeholder: 'Filter by name, trigram, title, territory or country…', class: 'filter',
    value: tbl.q,
    onInput: () => { tbl.q = filterBox.value; draw(); },
  });
  const wrap = h('div', { class: 'table-wrap players-table' });
  const card = h('div', { class: 'card' },
    sectionTitle('Every player', filterBox,
      h('span', { class: 'sec-sub' }, `${fmt.int(rows.length)} scoring trigrams`)),
    wrap);

  function draw() {
    const q = tbl.q.trim().toUpperCase();
    const hay = r => [r.name, r.trigram, r.title, r.territory, r.country, r.country_code]
      .map(x => String(x || '').toUpperCase()).join(' ');
    const shown = rows
      .filter(r => !q || hay(r).includes(q))
      .sort((a, b) => {
        const av = sortVal(a, tbl.key), bv = sortVal(b, tbl.key);
        return (av < bv ? -1 : av > bv ? 1 : 0) * tbl.dir;
      });
    clear(wrap);
    if (!shown.length) { wrap.appendChild(emptyState('Nobody matches that filter.')); return; }
    wrap.appendChild(h('table', null,
      h('thead', null, h('tr', null, [...COLS.map(([key, label]) =>
        h('th', {
          class: 'sortable' + (key === tbl.key ? (tbl.dir < 0 ? ' desc' : ' asc') : ''),
          onClick: () => {
            if (tbl.key === key) tbl.dir = -tbl.dir;
            else { tbl.key = key; tbl.dir = -1; }
            draw();
          },
        }, label)),
      canTag ? h('th', null, 'Staff') : null].filter(Boolean))),
      h('tbody', null, shown.map(r => {
        const tds = COLS.map(([key, , get], i) =>
          h('td', { class: (i === 1 ? 'mono' : '') + (i >= NUM_FROM && i <= NUM_TO ? ' num' : '') },
            get(r),
            i === 1 && excluded.includes(r.trigram) ? chip('staff', 'muted') : null));
        // Name, trigram and Accuracy all raise the full stat card — the
        // per-stream bars folded out of the old columns live there
        wirePop(tds[0], r, excluded);
        wirePop(tds[1], r, excluded);
        wirePop(tds[7], r, excluded);
        return h('tr', excluded.includes(r.trigram) ? { class: 'staff' } : null,
          tds, canTag ? h('td', null, staffBtn(r)) : null);
      }))));
  }
  draw();
  return card;
}
