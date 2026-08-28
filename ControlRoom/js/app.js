/* app.js — shell and router, the BRUCE pattern: a NAV table drives the
   sidebar, draw() switches on the route head and mounts a view. Views export
   render(params, rerender) and return a DOM node.

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
import * as system from './views/system.js';

const NAV = [
  ['dashboard', 'Dashboard', 'analytics', dashboard],
  ['players', 'Players', 'analytics', players],
  ['calendar', 'Calendar', 'calendar', calendar],
  ['banners', 'Banners', 'banners', banners],
  ['questions', 'Questions', 'content', questions],
  ['system', 'System', null, system], // shown to all; the card degrades per scope
];

let WHO = null; // {label, scopes, master}

function route() {
  const raw = location.hash.replace(/^#/, '') || '';
  const parts = raw.split('/').filter(Boolean);
  return { head: parts[0] || '', params: parts.slice(1) };
}

function allowed(entry) {
  if (!WHO) return false;
  const need = entry[2];
  if (!need) return true;
  return WHO.scopes.includes(need);
}

function draw() {
  const { head, params } = route();
  const main = $('main');
  const open = NAV.filter(allowed);
  if (!open.length) {
    clear(main).appendChild(h('div', { class: 'empty' },
      h('p', null, 'This key opens nothing. Ask for a key with at least one scope.')));
    return;
  }
  let entry = NAV.find(n => n[0] === head && allowed(n));
  if (!entry) { location.hash = '#' + open[0][0]; return; }

  // sidebar state
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('on', a.dataset.route === entry[0]));

  clear(main).appendChild(entry[3].render(params, draw));
}

function buildNav() {
  const nav = $('nav-list');
  clear(nav);
  NAV.filter(allowed).forEach(([key, label]) => {
    nav.appendChild(h('a', { href: '#' + key, dataset: { route: key } }, label));
  });
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

export function boot() {
  $('gate-go').addEventListener('click', () => tryKey($('gate-key').value));
  $('gate-key').addEventListener('keydown', e => { if (e.key === 'Enter') tryKey($('gate-key').value); });
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
