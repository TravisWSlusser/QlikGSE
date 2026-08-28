/* dashboard.js — the analytics read. One /api/admin/analytics call feeds
   everything (the BRUCE /api/state pattern). */
import { h, clear, fmt, esc } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip } from '../ui.js';
import { statTile, hbars, columns } from '../charts.js';
import { wirePop } from '../pop.js';

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

export function render(params, rerender) {
  const root = h('div', { class: 'view' });
  const status = h('div', { class: 'card st-card' }, spinner());
  const body = h('div', { class: 'view-body' }, spinner());
  root.append(status, body);
  loadStatus(status);
  load(body, rerender);
  return root;
}

/* ── the systems board ──
   Live probes of everything the apps stand on, redrawn every 60s while the
   Dashboard is open. Status is never color alone: every light carries its
   label (OK / SLOW-ish warn text / DOWN / OFF) and its one-line reason. */
const ST_LABEL = { ok: 'OK', warn: 'CHECK', down: 'DOWN', off: 'OFF' };

async function loadStatus(card) {
  let d;
  try { d = await api.systemStatus(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadStatus(card))); return; }
  clear(card);

  const banner = d.overall === 'ok'
    ? h('span', { class: 'st-banner ok' }, 'ALL SYSTEMS GO')
    : d.overall === 'warn'
      ? h('span', { class: 'st-banner warn' }, `${d.counts.warn} TO CHECK`)
      : h('span', { class: 'st-banner down' }, `${d.counts.down} DOWN`);
  card.appendChild(sectionTitle('Systems', banner,
    h('span', { class: 'sec-sub' }, 'checked ' + new Date(d.checkedAt).toLocaleTimeString())));

  // One compact strip of pills — dot, name, status tag. The full detail and
  // latency live in the hover tooltip; anything not-green also prints its
  // one-line reason underneath so a problem never hides in a tooltip.
  card.appendChild(h('div', { class: 'st-strip' }, (d.systems || []).map(s =>
    h('span', { class: 'st-pill', title: `${s.group} · ${s.detail}${s.ms != null ? ` · ${s.ms}ms` : ''}` },
      h('span', { class: 'st-dot ' + s.status }),
      s.name,
      h('i', { class: 'st-tag ' + s.status }, ST_LABEL[s.status] || s.status)))));
  const issues = (d.systems || []).filter(s => s.status === 'warn' || s.status === 'down');
  if (issues.length) {
    card.appendChild(h('div', { class: 'st-issues' }, issues.map(s =>
      h('p', { class: 'st-issue' }, h('b', null, s.name + ': '), s.detail))));
  }

  // one refresh cycle per open Dashboard; dies with the view
  setTimeout(() => { if (card.isConnected) loadStatus(card); }, 60_000);
}

async function load(root, rerender) {
  let d;
  try { d = await api.analytics(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender))); return; }
  clear(root);

  const t = d.totals || {};
  root.appendChild(h('div', { class: 'tiles tiles-5' },
    statTile('Players', fmt.int(t.players)),
    statTile('Games played', fmt.int(t.games)),
    statTile('Points scored', fmt.int(t.points)),
    statTile('Total playtime', fmtPlay(t.playtime),
      'across every player — counting since 28 Aug'),
    statTile('Answer accuracy', fmt.pct(t.correct, t.attempted),
      `${fmt.int(t.correct)} of ${fmt.int(t.attempted)} answers`)));

  // ── Game Masters + territory podiums, hover cards throughout ──
  const excluded = d.excluded || [];
  const top = d.top || [];
  const podium = (players, title) => {
    const col = h('div', { class: 'gm-col' },
      h('h3', { class: 'ss-h' }, title));
    if (!players.length) { col.appendChild(h('p', { class: 'sub' }, 'Nobody yet.')); return col; }
    col.appendChild(h('div', { class: 'gm-list' }, players.map((p, i) => {
      const row = h('div', { class: 'gm-row' },
        h('span', { class: 'gm-rank r' + (i + 1) }, ['🥇', '🥈', '🥉'][i] || String(i + 1)),
        h('span', { class: 'gm-trig mono' }, p.trigram,
          excluded.includes(p.trigram) ? chip('staff', 'muted') : null),
        h('span', { class: 'gm-pts num' }, fmt.int(p.total_score)));
      wirePop(row, p, excluded);
      return row;
    })));
    return col;
  };
  const TERRITORIES = ['NAM', 'LATAM', 'EMEA', 'APAC'];
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Game Masters', h('span', { class: 'sec-sub' }, 'hover a trigram for the full read')),
    h('div', { class: 'gm-grid' },
      podium(top.slice(0, 3), 'Worldwide'),
      ...TERRITORIES.map(terr =>
        podium(top.filter(p => p.territory === terr).slice(0, 3), terr)))));

  // ── Daily runs, last 30 days ──
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

  // ── Accuracy by learning stream — the counters nothing read until now ──
  const s = d.streams || {};
  grid.appendChild(h('div', { class: 'card' },
    sectionTitle('Accuracy by learning stream'),
    hbars(STREAMS.map(([name, a, c, what]) => ({
      label: name,
      value: s[a] > 0 ? 100 * s[c] / s[a] : 0,
      display: fmt.pct(s[c], s[a]),
      tipHtml: `<b>${name}</b> — ${esc(what)}<br>${fmt.int(s[c])} correct of ${fmt.int(s[a])} attempted`,
    })), { max: 100 })));

  // ── Territory standings ──
  grid.appendChild(h('div', { class: 'card' },
    sectionTitle('Points by territory'),
    hbars((d.territories || []).map(r => ({
      label: r.territory || '—',
      value: Number(r.points),
      tipHtml: `<b>${esc(r.territory || '—')}</b><br>${fmt.int(r.points)} pts · ${fmt.int(r.players)} players · `
        + `${fmt.int(r.games)} games · ${fmt.pct(r.correct, r.attempted)} accuracy`,
    })))));

  // ── Score distribution ──
  const buckets = d.distribution || [];
  if (buckets.length) {
    const rows = [];
    for (let b = 1; b <= 10; b++) {
      const hit = buckets.find(x => Number(x.bucket) === b);
      const lo = (b - 1) * 500, hi = b * 500;
      rows.push({
        label: String(lo),
        value: hit ? hit.n : 0,
        tipHtml: `<b>${lo}–${hi} pts</b><br>${hit ? fmt.int(hit.n) : 0} runs`,
      });
    }
    // width_bucket puts >= max in bucket 11
    const over = buckets.find(x => Number(x.bucket) === 11);
    if (over) rows.push({ label: '5000+', value: over.n, tipHtml: `<b>5000+ pts</b><br>${fmt.int(over.n)} runs` });
    grid.appendChild(h('div', { class: 'card' },
      sectionTitle('Score spread — last 500 runs'),
      columns(rows, { height: 120 })));
  }

  // ── Recent activity (table — the exact numbers, not another chart) ──
  grid.appendChild(h('div', { class: 'card' },
    sectionTitle('Recent runs'),
    h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null,
          ['When', 'Trigram', 'Territory', 'Points'].map(x => h('th', null, x)))),
        h('tbody', null, (d.recent || []).slice(0, 12).map(r =>
          h('tr', null,
            h('td', { class: 'mono sub' }, r.at),
            h('td', { class: 'mono' }, r.trigram,
              (d.excluded || []).includes(r.trigram) ? chip('staff', 'muted') : null),
            h('td', null, r.territory),
            h('td', { class: 'num' }, fmt.int(r.points)))))))));

  root.appendChild(h('p', { class: 'gen-note' },
    `Generated ${new Date(d.generatedAt).toLocaleString()}. Staff trigrams (${(d.excluded || []).join(', ') || 'none'}) `
    + 'are hidden from the public boards but included here — an admin view that dropped them would misreport every total.'));
}
