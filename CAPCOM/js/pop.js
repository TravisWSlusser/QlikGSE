/* pop.js — the player stat card raised by hovering a trigram. Shared by
   Home and the Dashboard so every trigram in CAPCOM behaves the same way.
   One floating element, rebuilt per player from the analytics top rows;
   stream bars use the dashboard's magnitude language (validated hue,
   direct labels). */
import { h, clear, fmt } from './util.js';
import { chip } from './ui.js';

let popEl = null;
function pop() {
  if (!popEl) { popEl = h('div', { id: 'player-pop' }); document.body.appendChild(popEl); }
  return popEl;
}

export function wirePop(el, p, excluded) {
  if (!p) return; // no stats known for this trigram
  el.classList.add('has-pop');
  el.addEventListener('mouseenter', () => showPop(el, p, excluded || []));
  el.addEventListener('mouseleave', hidePop);
}

export function hidePop() { if (popEl) popEl.style.display = 'none'; }

export function showPop(anchor, p, excluded) {
  const e = pop();
  clear(e);
  const bar = (label, c, at) => h('div', { class: 'pp-bar' },
    h('span', { class: 'pp-bar-label' }, label),
    h('div', { class: 'pp-track' }, h('div', { class: 'pp-fill', style: { width: (at > 0 ? Math.max(2, 100 * c / at) : 0) + '%' } })),
    h('span', { class: 'pp-bar-val' }, fmt.pct(c, at)));
  e.append(
    h('div', { class: 'pp-head' },
      h('span', { class: 'pp-trig mono' }, p.trigram),
      h('span', { class: 'pp-terr' }, `${p.territory} · ${(p.country_code || '').toUpperCase()}`),
      excluded.includes(p.trigram) ? chip('staff', 'muted') : null),
    h('div', { class: 'pp-stats' },
      h('div', { class: 'pp-stat' }, h('b', null, fmt.int(p.total_score)), h('i', null, 'points')),
      h('div', { class: 'pp-stat' }, h('b', null, fmt.int(p.games_played)), h('i', null, 'games')),
      h('div', { class: 'pp-stat' }, h('b', null, fmt.int(p.blitz_personal_high)), h('i', null, 'best run')),
      h('div', { class: 'pp-stat' }, h('b', null, fmt.dur(p.blitz_longest_sec)), h('i', null, 'longest'))),
    bar('Knowledge', p.q_correct, p.q_attempted),
    bar('Methodology', p.c_correct, p.c_attempted),
    bar('Glossary', p.t_correct, p.t_attempted),
    h('div', { class: 'pp-foot' }, `First seen ${p.first_seen} · last ${p.last_seen}`));
  e.style.display = 'block';
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 100, bottom: 100, top: 80 };
  const w = e.offsetWidth || 280;
  let x = Math.min(r.left, window.innerWidth - w - 16);
  let y = r.bottom + 10;
  if (y + (e.offsetHeight || 260) > window.innerHeight - 8) y = Math.max(8, r.top - (e.offsetHeight || 260) - 10);
  e.style.left = x + 'px';
  e.style.top = y + 'px';
}
