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
import { toast, modal, field, textInput } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as players from './views/players.js';
import * as calendar from './views/calendar.js';
import * as banners from './views/banners.js';
import * as questions from './views/questions.js';
import * as maintenance from './views/maintenance.js';
import * as system from './views/system.js';
import * as home from './views/home.js';
import * as projects from './views/projects.js';
import * as projectsInsights from './views/projectsInsights.js';
import * as staff from './views/staff.js';
import { ICONS } from './icons.js';
import { mountFx } from './fx.js';
import { hidePop } from './pop.js';

const NAV = [
  { group: '', items: [
    { route: 'home', label: 'Home', scope: null, mod: home, icon: 'home' },
  ]},
  { group: 'Mission Control', items: [
    { route: 'calendar', label: 'Calendar', scope: 'calendar', mod: calendar, icon: 'calendar' },
    { route: 'banners/highlights', label: 'Focused Headlines', scope: 'banners', mod: banners, icon: 'banners' },
    { route: 'banners/stellar', label: 'Action Banner', scope: 'banners', mod: banners, icon: 'stellar' },
  ]},
  { group: 'Projects', items: [
    // scope null on purpose: every key holder can SEE the board (visibility
    // is the product); edit controls gate on the 'projects' scope inside
    { route: 'projects', label: 'Project Board', scope: null, mod: projects, icon: 'projects' },
    { route: 'projects/staff', label: 'Staff', scope: null, mod: staff, icon: 'staff' },
    { route: 'projects/insights', label: 'Insights & Calendar', scope: null, mod: projectsInsights, icon: 'insights' },
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

  // A route change never fires mouseleave on whatever was hovered, so an
  // open stat card would float over the next view forever. Seen live.
  hidePop();

  // phone: picking a destination closes the drawer
  document.body.classList.remove('nav-open');

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
  $('who-label').textContent = WHO.master
    ? (WHO.label === 'ultra' ? 'Logged in using: Ultra Key' : 'Logged in using: Admin Key')
    : WHO.member ? WHO.label : `Logged in using: ${WHO.label}`;
  buildNav();
  draw();
  maybeUpdateBar();
}

/* The update banner: shown only to the leadership circle (system scope,
   or a team leader signed in as a member) when the deployed code's
   schema version is ahead of what Setup last stamped. One click runs
   the same idempotent Setup as the System view. */
function maybeUpdateBar() {
  const can = WHO && (WHO.scopes.includes('system') || WHO.leader);
  $('update-bar').style.display = (can && WHO.setup_pending) ? 'flex' : 'none';
  // the banner's dropdown: what the PENDING versions add
  const pending = (WHO && WHO.deploy_notes || [])
    .filter(e => WHO.schema_stamp == null || e.v > WHO.schema_stamp);
  clear($('update-notes')).append(...pending.map(e =>
    h('ul', { class: 'update-list' }, e.notes.map(n => h('li', null, n)))));
  // the sidebar chip: what is deployed, for anyone
  const chip = $('ver-chip');
  chip.style.display = WHO ? '' : 'none';
  chip.textContent = WHO ? `v${WHO.code_version}` : '';
}

function deployedDialog() {
  const notes = (WHO && WHO.deploy_notes) || [];
  modal('What is deployed',
    h('div', null,
      h('p', { class: 'sub' }, WHO.setup_pending
        ? `The app is running deploy v${WHO.code_version}, but the database is ${WHO.schema_stamp == null ? 'not set up yet' : 'at v' + WHO.schema_stamp} — an update is waiting.`
        : `Deploy v${WHO.code_version}, database in step. All current.`),
      ...notes.map(e => h('div', null,
        h('p', { class: 'sub', style: { margin: '10px 0 4px', fontWeight: '700' } }, `v${e.v}`),
        h('ul', { class: 'update-list' }, e.notes.map(n => h('li', null, n)))))),
    [{ label: 'Close', kind: 'accent', onClick: c => c() }]);
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

/* Claim-your-access: the member picks their own code, once, after an
   admin has put them in the registry. The code goes to memberClaim and
   is stored only as a hash server-side; on success we sign them in. */
function claimDialog() {
  const tri = textInput({ maxLength: 3, placeholder: 'TRI', style: { textTransform: 'uppercase' } });
  const c1 = h('input', { type: 'password', maxLength: 64, placeholder: '8+ characters' });
  const c2 = h('input', { type: 'password', maxLength: 64, placeholder: 'Same again' });
  modal('Claim your member access',
    h('div', { class: 'form' },
      h('p', { class: 'sub' }, 'You need to be in the team registry first — if your trigram is not found, ask an admin to add you from the Project Board’s Members manager.'),
      field('Your trigram', tri, 'The same three letters you use in the REC Room.'),
      field('Choose an access code', c1),
      field('Confirm it', c2)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Claim it', kind: 'accent', onClick: async c => {
        if (c1.value !== c2.value) { toast('The two codes do not match', 'err'); return; }
        try {
          const r = await api.memberClaim({ trigram: tri.value, code: c1.value });
          c();
          toast(`Welcome, ${r.name} — signing you in`);
          tryKey(`${tri.value.trim().toUpperCase()}:${c1.value}`);
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

export function boot() {
  mountFx();
  $('gate-go').addEventListener('click', () => tryKey($('gate-key').value));
  $('gate-key').addEventListener('keydown', e => { if (e.key === 'Enter') tryKey($('gate-key').value); });

  // member sign-in: trigram + self-set code travel as one `TRI:code` key
  // through the same tryKey/whoami path — auth.js does the verifying
  const memberGo = () => {
    const tri = $('gate-tri').value.trim().toUpperCase();
    const code = $('gate-code').value;
    if (!/^[A-Z]{3}$/.test(tri) || !code) { toast('Trigram (3 letters) and your access code', 'err'); return; }
    tryKey(`${tri}:${code}`);
  };
  $('gate-member').addEventListener('click', memberGo);
  $('gate-code').addEventListener('keydown', e => { if (e.key === 'Enter') memberGo(); });
  $('gate-claim').addEventListener('click', e => { e.preventDefault(); claimDialog(); });

  $('update-what').addEventListener('click', () => {
    const n = $('update-notes');
    n.hidden = !n.hidden;
    $('update-what').textContent = n.hidden ? '▾' : '▴';
  });
  $('ver-chip').addEventListener('click', deployedDialog);
  $('update-run').addEventListener('click', async () => {
    const btn = $('update-run');
    btn.disabled = true; btn.textContent = 'Updating…';
    try {
      const r = await api.migrate();
      toast('Updated — ' + ((r.done || []).slice(-1)[0] || 'nothing to do'));
      WHO = await api.whoami();
      maybeUpdateBar();
      draw();
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = 'Update now';
  });
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('signout').addEventListener('click', () => {
    keyStore.clear(); WHO = null;
    toast('Signed out');
    showGate();
  });
  window.addEventListener('hashchange', () => { if (WHO) draw(); });

  // phone drawer: burger opens, backdrop (or navigating) closes
  $('nav-burger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('nav-back').addEventListener('click', () => document.body.classList.remove('nav-open'));

  const stored = keyStore.get();
  if (stored) tryKey(stored); else showGate();
}

boot();
