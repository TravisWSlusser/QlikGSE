/* app.js — shell and router, the BRUCE pattern: a NAV table drives the
   sidebar, draw() switches on the route and mounts a view. Views export
   render(params, rerender) and return a DOM node.

   NAV is grouped BY APP — Mission Control first, then the REC Room — so
   "where do I change that?" answers itself: it's under the app you saw it
   on. Both banner boards are Mission Control page widgets, so they live
   there as two separate entries sharing one view module.

   Access: the key gate runs before anything else. whoami() turns a pasted
   key into a scope list; NAV filters to what the key can actually open, so
   an SME with only `content` sees Questions and nothing else. */
import { h, clear, $ } from './util.js';
import { api, keyStore } from './api.js';
import { toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as players from './views/players.js';
import * as calendar from './views/calendar.js';
import * as banners from './views/banners.js';
import * as questions from './views/questions.js';
import * as maintenance from './views/maintenance.js';
import * as system from './views/system.js';
import * as home from './views/home.js';
import { ICONS } from './icons.js';
import { mountFx } from './fx.js';

const NAV = [
  { group: '', items: [
    { route: 'home', label: 'Home', scope: null, mod: home, icon: 'home' },
  ]},
  { group: 'Mission Control', items: [
    { route: 'calendar', label: 'Calendar', scope: 'calendar', mod: calendar, icon: 'calendar' },
    { route: 'banners/highlights', label: 'Focused Headlines', scope: 'banners', mod: banners, icon: 'banners' },
    { route: 'banners/stellar', label: 'Action Banner', scope: 'banners', mod: banners, icon: 'stellar' },
  ]},
  { group: 'REC Room', items: [
    { route: 'dashboard', label: 'Dashboard', scope: 'analytics', mod: dashboard, icon: 'dashboard' },
    { route: 'players', label: 'Players', scope: 'analytics', mod: players, icon: 'players' },
    { route: 'questions', label: 'Questions', scope: 'content', mod: questions, icon: 'questions' },
  ]},
  { group: 'System', items: [
    { route: 'maintenance', label: 'Maintenance', scope: 'system', mod: maintenance, icon: 'maintenance' },
    { route: 'system', label: 'Access & Setup', scope: 'system', mod: system, icon: 'system' },
  ]},
];

let WHO = null; // {label, scopes, master}

const allItems = () => NAV.flatMap(g => g.items);
const allowed = it => !!WHO && (!it.scope || WHO.scopes.includes(it.scope));

/* Route → nav item. An exact match wins (banners/stellar); otherwise the
   first item whose head segment matches (questions/glossary_terms →
   questions). */
function findItem(raw, head) {
  const open = allItems().filter(allowed);
  return open.find(it => it.route === raw)
    || open.find(it => it.route.split('/')[0] === head);
}

function draw() {
  const raw = location.hash.replace(/^#/, '') || '';
  const parts = raw.split('/').filter(Boolean);
  const head = parts[0] || '';
  const main = $('main');
  const open = allItems().filter(allowed);
  if (!open.length) {
    clear(main).appendChild(h('div', { class: 'empty' },
      h('p', null, 'This key opens nothing. Ask for a key with at least one scope.')));
    return;
  }
  const item = findItem(raw, head);
  if (!item) { location.hash = '#' + open[0].route; return; }

  // sidebar state: exact route on, else head match for param routes the
  // nav doesn't list (questions tabs)
  document.querySelectorAll('.nav a').forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle('on', r === raw || (r === item.route && item.route.split('/')[0] === head));
  });

  clear(main).appendChild(item.mod.render(parts.slice(1), draw, WHO));
}

function buildNav() {
  const nav = $('nav-list');
  clear(nav);
  for (const g of NAV) {
    const items = g.items.filter(allowed);
    if (!items.length) continue;
    if (g.group) nav.appendChild(h('div', { class: 'nav-group' }, g.group));
    items.forEach(it => nav.appendChild(
      h('a', { href: '#' + it.route, dataset: { route: it.route } },
        h('span', { class: 'nav-ic', html: ICONS[it.icon] || '' }),
        it.label)));
  }
}

function showApp() {
  $('gate').style.display = 'none';
  $('shell').style.display = '';
  $('who-label').textContent = WHO.master ? 'master key' : WHO.label;
  buildNav();
  draw();
}

function showGate(msg) {
  $('shell').style.display = 'none';
  $('gate').style.display = '';
  if (msg) { const e = $('gate-err'); e.textContent = msg; e.style.display = ''; }
  $('gate-key').focus();
}

async function tryKey(key) {
  keyStore.set(key.trim());
  const btn = $('gate-go');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    WHO = await api.whoami();
    showApp();
  } catch (err) {
    keyStore.clear();
    showGate(err.status === 401 ? 'That key is not valid.' : err.message);
  }
  btn.disabled = false; btn.textContent = 'Enter';
}

/* Theme: data-theme on <html>, set pre-paint by the inline snippet in
   index.html; the toggle just flips and persists. Charts follow via CSS
   custom properties, so nothing re-renders. */
function toggleTheme() {
  const el = document.documentElement;
  const next = el.dataset.theme === 'light' ? 'dark' : 'light';
  el.dataset.theme = next;
  try { localStorage.setItem('capcom.theme', next); } catch {}
}

export function boot() {
  mountFx();
  $('gate-go').addEventListener('click', () => tryKey($('gate-key').value));
  $('gate-key').addEventListener('keydown', e => { if (e.key === 'Enter') tryKey($('gate-key').value); });
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('signout').addEventListener('click', () => {
    keyStore.clear(); WHO = null;
    toast('Signed out');
    showGate();
  });
  window.addEventListener('hashchange', () => { if (WHO) draw(); });

  const stored = keyStore.get();
  if (stored) tryKey(stored); else showGate();
}

boot();
