/* brief.js — the Leadership Brief: week / month / quarter, compiled
   from the board so Nick and Mike can carry it upward. Facts first
   (deterministic, straight from the database); the Claude executive
   summary is garnish on a report that is already true. */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import { toast, sectionTitle, spinner, errorState, emptyState } from '../ui.js';

const WINDOWS = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']];

export function render(params, rerender, who) {
  const root = h('div', { class: 'view' });
  const card = h('div', { class: 'card' }, spinner());
  root.appendChild(card);
  load(card, 'week');
  return root;
}

async function load(card, windowName) {
  clear(card).appendChild(spinner());
  let r;
  try { r = await api.brief({ op: 'digest', window: windowName }); }
  catch (err) { clear(card).appendChild(errorState(err, () => load(card, windowName))); return; }
  const d = r.digest;
  clear(card);

  const tabs = h('div', { class: 'brief-tabs' }, WINDOWS.map(([w, label]) =>
    h('button', { class: 'btn sm' + (w === windowName ? ' accent' : ''), onClick: () => load(card, w) }, label)));
  card.appendChild(sectionTitle('Leadership Brief',
    h('span', { class: 'sec-sub' }, `last ${d.days} days · generated live from the board`),
    tabs,
    h('button', { class: 'btn sm', onClick: () => copyBrief(d, windowName, card) }, 'Copy As Text')));

  // headline counts, flat
  card.appendChild(h('p', { class: 'brief-counts' },
    `${d.counts.active} active projects · ${d.counts.moved} status moves · ` +
    `${d.milestonesHit.length} milestones hit · ${d.counts.overdue} overdue · ` +
    `${d.counts.new} new · ${d.counts.lulls} without activity`));

  // the executive summary — appears when a key is set
  const aiBox = h('div', { class: 'brief-ai' });
  if (r.ai_ready) {
    const btn = h('button', { class: 'btn sm accent', onClick: async () => {
      btn.disabled = true; btn.textContent = 'Writing…';
      try {
        const n = await api.brief({ op: 'narrate', window: windowName });
        clear(aiBox).append(
          h('div', { class: 'brief-ai-text' }, n.text),
          h('p', { class: 'sub' }, (n.cached ? 'From the last 6 hours. ' : '') + 'Written by Claude from the facts below — read before you send it.'));
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Write The Executive Summary'; }
    } }, 'Write The Executive Summary');
    aiBox.appendChild(btn);
  } else {
    aiBox.appendChild(h('p', { class: 'sub' },
      'Want a written executive summary on top of these facts? Add an ANTHROPIC_API_KEY under Maintenance → Keys & Services and a button appears here.'));
  }
  card.appendChild(aiBox);

  const section = (title, rows, renderRow, empty) => {
    card.appendChild(h('div', { class: 'brief-sec-t' }, title));
    if (!rows.length) { card.appendChild(h('p', { class: 'sub' }, empty)); return; }
    card.appendChild(h('div', { class: 'brief-sec' }, ...rows.map(renderRow)));
  };

  section('Moved', d.moved, m => h('div', { class: 'brief-row' },
    h('b', null, m.project), h('span', { class: 'sub' },
      ` ${m.from ? m.from + ' → ' : ''}${m.to}${m.team ? ' · ' + m.team : ''}${m.note ? ' — ' + m.note : ''}`)),
    'No status changes in this window.');
  section('Milestones Hit', d.milestonesHit, m => h('div', { class: 'brief-row' },
    h('b', null, m.title), h('span', { class: 'sub' }, ` ${m.project} · ${m.date}`)),
    'No milestones landed in this window.');
  section('Milestones Ahead', d.milestonesUpcoming, m => h('div', { class: 'brief-row' },
    h('b', null, m.title), h('span', { class: 'sub' }, ` ${m.project} · ${m.date}`)),
    'Nothing dated in the next window.');
  section('Overdue Right Now', d.overdueNow, o => h('div', { class: 'brief-row over' },
    h('b', null, o.project), h('span', { class: 'sub' }, ` ${o.status} · promised ${o.due}${o.team ? ' · ' + o.team : ''}`)),
    'Nothing overdue. All promises holding.');
  section('What The Logs Say', d.overdueNotes, o => h('div', { class: 'brief-row' },
    h('b', null, o.project), h('span', { class: 'sub' }, ` — ${o.note} (${o.actor})`)),
    'No written explanations were needed in this window.');
  section('New Projects', d.newProjects, p => h('div', { class: 'brief-row' },
    h('b', null, p.project), h('span', { class: 'sub' }, ` ${p.status}${p.due ? ' · due ' + p.due : ''}${p.team ? ' · ' + p.team : ''}`)),
    'No new projects posted.');
  section('Lulls — No Recorded Activity', d.lulls, p => h('div', { class: 'brief-row lull' },
    h('b', null, p.project), h('span', { class: 'sub' }, ` ${p.status}${p.due ? ' · due ' + p.due : ''}${p.team ? ' · ' + p.team : ''}`)),
    'Every active project had activity. No lulls.');
  if (d.quietTeams.length) {
    card.appendChild(h('p', { class: 'sub' }, `Quiet teams (no logged activity at all): ${d.quietTeams.join(', ')}`));
  }
}

function copyBrief(d, windowName, card) {
  const ai = card.querySelector('.brief-ai-text');
  const L = [];
  L.push(`SALES ENABLEMENT — LEADERSHIP BRIEF (last ${d.days} days)`);
  L.push(`${d.counts.active} active · ${d.counts.moved} moves · ${d.milestonesHit.length} milestones hit · ${d.counts.overdue} overdue · ${d.counts.new} new`);
  if (ai) { L.push('', ai.textContent); }
  const block = (t, rows, f) => { if (rows.length) { L.push('', t.toUpperCase()); rows.forEach(x => L.push('• ' + f(x))); } };
  block('Moved', d.moved, m => `${m.project}: ${m.from ? m.from + ' → ' : ''}${m.to}${m.note ? ' — ' + m.note : ''}`);
  block('Milestones hit', d.milestonesHit, m => `${m.title} (${m.project}, ${m.date})`);
  block('Milestones ahead', d.milestonesUpcoming, m => `${m.title} (${m.project}, ${m.date})`);
  block('Overdue', d.overdueNow, o => `${o.project} — ${o.status}, promised ${o.due}`);
  block('New projects', d.newProjects, p => `${p.project} (${p.status}${p.due ? ', due ' + p.due : ''})`);
  block('Lulls (no recorded activity)', d.lulls, p => `${p.project} (${p.status})`);
  if (d.quietTeams.length) L.push('', 'Quiet teams: ' + d.quietTeams.join(', '));
  const text = L.join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast('Brief copied — paste it anywhere'))
    .catch(() => toast('Copy failed — select and copy by hand', 'err'));
}
