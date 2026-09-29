/* players.js — MT Roster: the health page.
 *
 * This used to be the scores table. Scores moved to the Dashboard, where a
 * scoreboard belongs, and this page took over the job nothing owned: is the
 * plumbing up, is the roster current, and is anyone actually playing.
 *
 * Three questions, in that order:
 *
 *   STATUS   — the systems board, live probes of everything the apps stand
 *              on. It sat on the Dashboard, which is now a room-facing
 *              scoreboard; a red light does not belong next to a podium.
 *   ROSTER   — trigram → real identity, and specifically where that mapping
 *              is BROKEN. A trigram that scores with no roster row shows as
 *              a blank name on the public board (the LKG case, 28 Sep), and
 *              until now the only way to find one was to notice it.
 *   ACTIVITY — who is playing, who has gone quiet, and the 30-day shape.
 *
 * No new endpoint. Everything here is computed from the analytics payload
 * this page already fetched plus roster stats: `top` rows carry `name` only
 * when rec_roster matched them, so the unmatched list is a filter, not a
 * query. Keeping it client-side means the health page cannot be the thing
 * that breaks.
 */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, toast } from '../ui.js';
import { statTile, columns } from '../charts.js';
import { wirePop } from '../pop.js';

const ST_LABEL = { ok: 'OK', warn: 'CHECK', down: 'DOWN', off: 'OFF' };
const DAY = 86_400_000;

export function render(params, rerender, viewer) {
  const root = h('div', { class: 'view' });
  const status = h('div', { class: 'card st-card' }, spinner());
  const body = h('div', { class: 'view-body' }, spinner());
  root.append(status, body);
  loadStatus(status);
  load(body, rerender, viewer);
  return root;
}

/* ── the systems board ──
   Live probes, redrawn every 60s while the page is open. Status is never
   color alone: every light carries its label (OK / CHECK / DOWN / OFF) and
   its one-line reason. */
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

  // one refresh cycle per open page; dies with the view
  setTimeout(() => { if (card.isConnected) loadStatus(card); }, 60_000);
}

async function load(root, rerender, viewer) {
  let d;
  try { d = await api.analytics(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, viewer))); return; }
  // Roster stats can 403 on an older deploy where the op still wanted the
  // 'projects' scope. A health page must degrade, not blank.
  let rs = null;
  try { rs = await api.roster({ op: 'stats' }); } catch { /* shown as unknown */ }
  clear(root);

  const players = d.top || [];
  const matched = players.filter(p => p.name);
  const orphans = players.filter(p => !p.name);
  const rosterCount = rs && rs.count ? Number(rs.count) : 0;
  const neverPlayed = rosterCount ? Math.max(0, rosterCount - matched.length) : null;

  // ── ROSTER HEALTH ──
  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Roster health',
      rs && rs.count
        ? h('span', { class: 'sec-sub' }, `imported ${String(rs.updated || '').slice(0, 10)}`)
        : chip('not imported', 'warn')),
    h('div', { class: 'tiles tiles-4' },
      statTile('People on the roster', rosterCount ? fmt.int(rosterCount) : '—',
        'from the Mindtickle user export'),
      statTile('Have played', fmt.int(matched.length),
        rosterCount ? fmt.pct(matched.length, rosterCount) + ' of the roster' : 'matched to a roster row'),
      statTile('Never played', neverPlayed == null ? '—' : fmt.int(neverPlayed),
        'on the roster, no run recorded'),
      statTile('Unmatched trigrams', fmt.int(orphans.length),
        orphans.length ? 'scoring with no roster row' : 'every scorer has a name')),
    orphans.length
      ? h('div', { class: 'orphans' },
        h('p', { class: 'explain' },
          h('b', null, 'These trigrams score but have no name. '),
          'They show as a blank on the public scoreboard hover card. Either the person is '
          + 'missing from the latest Mindtickle export, or they entered a trigram that is not theirs. '
          + 'Re-import below once the export has them.'),
        h('div', { class: 'orphan-list' }, orphans.map(p => {
          const pill = h('span', { class: 'orphan' },
            h('b', { class: 'mono' }, p.trigram),
            h('span', { class: 'sub' },
              `${p.territory || '—'} · ${(p.country_code || '').toUpperCase() || '—'} · `
              + `${fmt.int(p.total_score)} pts · last seen ${String(p.last_seen || '').slice(0, 10) || '—'}`));
          wirePop(pill, p, d.excluded || []);
          return pill;
        })))
      : null));

  // ── ACTIVITY ──
  const now = Date.now();
  const age = p => {
    const t = Date.parse(String(p.last_seen || '').replace(' ', 'T') + 'Z');
    return Number.isNaN(t) ? Infinity : (now - t) / DAY;
  };
  const band = (lo, hi) => players.filter(p => { const a = age(p); return a >= lo && a < hi; }).length;
  const dormant = players.filter(p => age(p) >= 30);

  root.appendChild(h('div', { class: 'card' },
    sectionTitle('Activity', h('span', { class: 'sec-sub' }, 'by when a player was last seen')),
    h('div', { class: 'tiles tiles-4' },
      statTile('Active this week', fmt.int(band(0, 7)), 'played in the last 7 days'),
      statTile('Active this month', fmt.int(band(0, 30)), 'played in the last 30 days'),
      statTile('Gone quiet', fmt.int(band(7, 30)), '7–30 days since a run'),
      statTile('Dormant', fmt.int(dormant.length), 'no run in over 30 days')),
    (d.daily || []).length
      ? columns((d.daily || []).map(r => ({
        label: fmt.day(r.day),
        value: r.players,
        tipHtml: `<b>${fmt.day(r.day)}</b><br>${fmt.int(r.players)} distinct players · ${fmt.int(r.runs)} runs`,
      })), { height: 120 })
      : h('p', { class: 'sub' }, 'No runs recorded in the last 30 days.')));

  // ── IMPORT ──
  root.appendChild(importCard(rs, viewer, rerender));
}

/* The roster import, moved here from Maintenance. It is the one control on
   the MT Roster page that changes anything, and Maintenance now points at
   it rather than carrying a second copy.
   Manager/master only — enforced server-side in roster.js, mirrored here so
   the control is not dangled at someone who cannot use it. */
function importCard(rs, viewer, rerender) {
  const card = h('div', { class: 'card' },
    sectionTitle('Import the Mindtickle roster',
      rs && rs.count
        ? h('span', { class: 'sec-sub' }, `${fmt.int(rs.count)} people on file`)
        : null));

  const canImport = !!(viewer && (viewer.master || viewer.manager));
  if (!canImport) {
    card.appendChild(h('p', { class: 'explain' },
      'Trigram → real name, title and country, from the Mindtickle user export. '
      + 'Importing is a manager action — ask Travis to run a fresh export.'));
    return card;
  }

  card.appendChild(h('p', { class: 'explain' },
    'Import the converted JSON (ask for rec-roster.json from the latest UserRoster export). '
    + 'Re-importing upserts on trigram, so a fresh export just updates in place — nothing is '
    + 'deleted and no score is touched. This is employee data: it lives in the database only, '
    + 'never in the repo.'));

  const file = h('input', { type: 'file', accept: 'application/json,.json' });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      let rows;
      try { rows = JSON.parse(String(rd.result)); } catch { toast('That is not valid JSON', 'err'); return; }
      if (!Array.isArray(rows) || !rows.length) { toast('Expected an array of roster rows', 'err'); return; }
      let done = 0;
      try {
        for (let i = 0; i < rows.length; i += 400) {
          const r = await api.roster({ op: 'import', rows: rows.slice(i, i + 400) });
          done += r.imported || 0;
        }
        toast(`Roster imported — ${done} people`);
        rerender();
      } catch (err) { toast(`${err.message} (${done} imported before the error)`, 'err'); }
    };
    rd.readAsText(f);
  });
  card.appendChild(file);
  return card;
}
