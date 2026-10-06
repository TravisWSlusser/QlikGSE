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
import { preview, effectiveWho } from './preview.js';
import { hideTip } from './avatar.js';
import { toast, modal, field, textInput } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as players from './views/players.js';
import * as calendar from './views/calendar.js';
import * as banners from './views/banners.js';
import * as questions from './views/questions.js';
import * as maintenance from './views/maintenance.js';
import * as tailoredAccess from './views/tailoredAccess.js';
import * as brief from './views/brief.js';
import * as home from './views/home.js';
import * as projects from './views/projects.js';
import * as projectsInsights from './views/projectsInsights.js';
import * as staff from './views/staff.js';
import * as profile from './views/profile.js';
import * as projectPage from './views/projectPage.js';
import * as help from './views/help.js';
import { maybeAutoStart, killTour } from './tour.js';
import { ICONS } from './icons.js';
import { mountFx } from './fx.js';
import { hidePop } from './pop.js';

const NAV = [
  { group: '', items: [
    { route: 'home', label: 'Home', scope: null, mod: home, icon: 'home' },
  ]},
  { group: 'Mission Control', items: [
    // "Mindtickle Calendar" - the learner-facing one. The TEAM calendar is
    // a tab on Home and a card on GSE Central; naming this one plainly is
    // what stops the two being confused.
    { route: 'calendar', label: 'Mindtickle Calendar', scope: 'calendar', mod: calendar, icon: 'calendar' },
    { route: 'banners/highlights', label: 'Focused Headlines', scope: 'banners', mod: banners, icon: 'banners' },
    // label only - the ROUTE stays banners/stellar so saved links survive
    { route: 'banners/stellar', label: 'AI Highlights', scope: 'banners', mod: banners, icon: 'stellar' },
  ]},
  /* Labels only. Every ROUTE under here still starts with projects/ —
     renaming those would break saved links and the deep-links the app
     uses itself. */
  { group: 'GSE Community', items: [
    /* GSE Central leads the group: it is the section's front door now -
       what is in flight, what is due, who is on what - and the Board is
       where you go to change something. Landing on the summary and
       stepping into the editor reads better than the reverse. */
    { route: 'projects/insights', label: 'GSE Central', scope: null, mod: projectsInsights, icon: 'insights' },
    // scope null on purpose: every key holder can SEE the board (visibility
    // is the product); edit controls gate on the 'projects' scope inside
    { route: 'projects', label: 'Project Board', scope: null, mod: projects, icon: 'projects' },
    { route: 'projects/staff', label: 'Our Organization', scope: null, mod: staff, icon: 'staff' },
    /* Two pages you arrive at by CLICKING something, never from the
       sidebar - a person's face, or a project's name. nav:false keeps
       them routable without giving either a nav row. */
    { route: 'profile', label: 'Profile', scope: null, mod: profile, icon: 'staff', nav: false },
    { route: 'project', label: 'Project', scope: null, mod: projectPage, icon: 'projects', nav: false },
  ]},
  { group: 'REC Room', items: [
    // scope null: everyone sees the scoreboard - names, map, standings, the
    // full table. The one privileged control on it (tag as staff, setStaff)
    // gates on 'system' inside the table, not on the page.
    { route: 'dashboard', label: 'Dashboard', scope: null, mod: dashboard, icon: 'dashboard' },
    // MT Roster is the HEALTH page: systems board, roster coverage, activity
    // and the roster import. 'analytics' because it reads the same payload.
    { route: 'players', label: 'MT Roster', scope: 'analytics', mod: players, icon: 'players' },
    { route: 'questions', label: 'Questions', scope: 'content', mod: questions, icon: 'questions' },
  ]},
  /* Authority & Control — the privileged tier, in one place.
     Everything here was manager- or scope-gated and scattered: the Brief
     sat under Projects next to pages the whole team opens, Maintenance
     kept company with Help & FAQ, and Tailored Access sat under Projects
     because hiding it would have hidden it from the staff granted
     'access'. Locked items are shown rather than hidden now (see
     buildNav), so that last reason is gone and the grouping can say what
     the sidebar could not: this is the tier, not a page. */
  { group: 'Authority & Control', items: [
    { route: 'projects/brief', label: 'Leadership Brief', scope: 'projects', mod: brief, icon: 'insights',
      gate: w => w.master || w.manager },
    // 'access' is the read-only tier here; 'system' mints and revokes
    { route: 'projects/access', label: 'Tailored Access', scope: ['system', 'access'], mod: tailoredAccess, icon: 'system' },
    { route: 'maintenance', label: 'Maintenance', scope: 'system', mod: maintenance, icon: 'maintenance' },
  ]},
  { group: 'System', items: [
    { route: 'help', label: 'Help & FAQ', scope: null, mod: help, icon: 'help' },
  ]},
];

let WHO = null; // {label, scopes, master}

const allItems = () => NAV.flatMap(g => g.items);
/* it.scope may be a string, an array (ANY of them admits - same rule
   requireScope uses on the server), or null for "every key holder". */
/* Everything the shell shows is decided against VIEW, not WHO — that one
   indirection is the whole preview feature. VIEW is WHO unless a preview is
   running, in which case it is the previewed staff member. */
const VIEW = () => effectiveWho(WHO);
const allowed = it => { const w = VIEW(); return !!w
  && (!it.scope || (Array.isArray(it.scope)
        ? it.scope.some(sc => w.scopes.includes(sc))
        : w.scopes.includes(it.scope)))
  && (!it.gate || it.gate(w)); };

/* Route → nav item, most specific first:
     1. an exact match          (projects/insights)
     2. a route that IS the head (projects/new → the Project Board)
     3. the first item whose head segment matches
        (banners/stellar/new → banners/highlights, which reads the board
         off params[0]; questions/glossary_terms → questions)

   Step 2 is not cosmetic. There was no rule between "exact" and "any
   sibling" until GSE Central moved to the top of the Projects group, at
   which point '#projects/new' — Home's New project action — prefix-matched
   projects/insights and quietly opened GSE Central instead of the board.
   Groups get reordered; matching must not depend on the order. */
function findItem(raw, head) {
  const open = allItems().filter(allowed);
  return open.find(it => it.route === raw)
    || open.find(it => it.route === head)
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
  hideTip();               // same reason, for the avatar tooltip
  staff.hideStaffPop();    // and the Staff hover peek
  hideNavTip();            // and the locked-row explainer

  // phone: picking a destination closes the drawer
  document.body.classList.remove('nav-open');

  // sidebar state: exact route on, else head match for param routes the
  // nav doesn't list (questions tabs)
  document.querySelectorAll('.nav a').forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle('on', r === raw || (r === item.route && item.route.split('/')[0] === head));
  });

  killTour(); // a route change mid-tour tears the overlay down, no state write
  clear(main).appendChild(item.mod.render(parts.slice(1), draw, WHO));
  // every page's walkthrough runs the first time that page is opened
  maybeAutoStart(item.route);
}

/* nav:false routes are reachable by hash but never listed - see the
   Profile entry above.

   EVERY other item is listed, whether or not this person can open it.
   Hiding them meant a staff member had no way to tell the difference
   between "CAPCOM has no calendar" and "the calendar is not mine to
   edit", and the second one looked like a bug. A locked row is greyed,
   carries a padlock, and explains itself on hover.

   A locked row is NOT an anchor - no href, no route in the hash - so
   clicking it cannot navigate anywhere. The gate is still findItem()
   and, underneath all of it, requireScope on the server. This is
   signposting, never permission. */
function buildNav() {
  const nav = $('nav-list');
  clear(nav);
  for (const g of NAV) {
    const items = g.items.filter(it => it.nav !== false);
    if (!items.length) continue;
    if (g.group) nav.appendChild(h('div', { class: 'nav-group' }, g.group));
    items.forEach(it => {
      const open = allowed(it);
      const icon = h('span', { class: 'nav-ic', html: ICONS[it.icon] || '' });
      if (open) {
        nav.appendChild(h('a', {
          href: '#' + it.route,
          dataset: it.route === 'help' ? { route: it.route, tour: 'help' } : { route: it.route },
        }, icon, it.label));
        return;
      }
      const row = h('span', {
        class: 'nav-locked', role: 'link', 'aria-disabled': 'true', tabindex: '0',
        dataset: { route: it.route },
      }, icon, h('span', { class: 'nav-lk-label' }, it.label),
        h('span', { class: 'nav-lk-ic', html: LOCK }));
      /* The panel is ONE fixed-position node for the whole sidebar, not a
         child of the row. As a child it sat inside .nav (overflow-y:auto),
         which gave the sidebar a horizontal scrollbar and clipped the
         panel at its edge. Same pattern as the avatar tooltip. */
      row.addEventListener('mouseenter', () => showNavTip(row, it));
      row.addEventListener('focus', () => showNavTip(row, it));
      row.addEventListener('mouseleave', hideNavTip);
      row.addEventListener('blur', hideNavTip);
      nav.appendChild(row);
    });
  }
}

let navTipEl = null;
function showNavTip(anchor, it) {
  if (!navTipEl) {
    navTipEl = h('div', { id: 'nav-tip', role: 'tooltip' });
    document.body.appendChild(navTipEl);
  }
  clear(navTipEl).append(
    h('b', null, 'Additional access required'),
    h('span', null, lockedWhy(it)));
  navTipEl.style.display = 'flex';
  const r = anchor.getBoundingClientRect();
  const w = navTipEl.offsetWidth, hh = navTipEl.offsetHeight;
  // beside the row, flipped under it when the drawer is full-width
  const beside = r.right + 10;
  if (beside + w < window.innerWidth - 8) {
    navTipEl.style.left = beside + 'px';
    navTipEl.style.top = Math.max(8, Math.min(window.innerHeight - hh - 8, r.top + r.height / 2 - hh / 2)) + 'px';
  } else {
    navTipEl.style.left = Math.max(8, r.left) + 'px';
    navTipEl.style.top = Math.min(window.innerHeight - hh - 8, r.bottom + 6) + 'px';
  }
}
function hideNavTip() { if (navTipEl) navTipEl.style.display = 'none'; }

/* What to ask for, in the words the checkboxes use on Our Organization.
   A person reading this should be able to repeat it to their leader
   verbatim. */
const SCOPE_WORDS = {
  calendar: 'Calendar', banners: 'Hero Banners', content: 'Questions',
  analytics: 'Analytics', access: 'Tailored Access', system: 'system',
  projects: 'projects',
};
function lockedWhy(it) {
  /* A gated item names no scope. 'projects' and 'system' are not on the
     Staff profile's checklist (GRANTABLE excludes them), so telling
     someone to ask for one sends them to a leader who cannot grant it.
     The honest sentence is that this tier is not granted, it is held. */
  if (it.gate) return 'Held by the leadership circle — managers and masters only.';
  const names = (Array.isArray(it.scope) ? it.scope : [it.scope])
    .filter(Boolean).map(sc => SCOPE_WORDS[sc] || sc);
  const askable = (Array.isArray(it.scope) ? it.scope : [it.scope])
    .filter(sc => GRANTABLE_WORDS.includes(sc));
  if (!names.length) return 'Ask Travis for access to this area.';
  if (!askable.length) return `Needs the ${names.join(' or ')} scope, which only a manager holds.`;
  return `Ask a leader to tick ${askable.map(sc => SCOPE_WORDS[sc]).join(' or ')} on your profile under Our Organization.`;
}

/* Mirrors GRANTABLE in lib/admin/auth.js — the only scopes that actually
   appear as checkboxes on a Staff row. Anything else is manager-held and
   must not be described as something to ask for. */
const GRANTABLE_WORDS = ['calendar', 'banners', 'content', 'analytics', 'access'];

const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/>'
  + '<path d="M8.4 10.5V7.8a3.6 3.6 0 0 1 7.2 0v2.7"/></svg>';

/* A running preview puts a bar across the top that cannot be missed and
   cannot be mistaken for a real session. It states what the preview does and
   does not prove, because someone WILL open a page during one and read the
   data as evidence that the permission works. */
function previewBar() {
  let bar = $('preview-bar');
  if (!bar) {
    bar = h('div', { id: 'preview-bar' });
    document.body.insertBefore(bar, document.body.firstChild);
  }
  const p = preview.get();
  if (!p) { bar.style.display = 'none'; document.body.classList.remove('previewing'); return; }
  bar.style.display = 'flex';
  document.body.classList.add('previewing');
  clear(bar).append(
    h('span', { class: 'pv-eye' }, 'Previewing as'),
    h('b', null, p.name),
    h('span', { class: 'pv-note' },
      p.scopes.length ? p.scopes.join(' · ') : 'no extra areas'),
    h('span', { class: 'pv-warn' }, 'look-only · sidebar only — pages still load with YOUR access'),
    h('button', { class: 'btn sm', onClick: () => preview.clear() }, 'Exit preview'));
}

preview.onChange(() => { previewBar(); buildNav(); draw(); });

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
  const w = VIEW();
  const can = w && (w.scopes.includes('system') || w.leader);
  $('update-bar').style.display = (can && w.setup_pending) ? 'flex' : 'none';
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
  const reveal = () => {
    $('gate').style.display = '';
    $('gate').classList.add('gate-in');
    if (msg) { const e = $('gate-err'); e.textContent = msg; e.style.display = ''; }
    $('gate-key').focus();
  };
  // first load of a session: a beat of Welcome, then the gate animates in
  let seen = false;
  try { seen = sessionStorage.getItem('capcom.hello') === '1'; } catch {}
  if (seen) { reveal(); return; }
  try { sessionStorage.setItem('capcom.hello', '1'); } catch {}
  $('gate').style.display = 'none';
  const hello = h('div', { id: 'hello' }, h('div', { class: 'hello-word' }, 'Welcome'));
  document.body.appendChild(hello);
  setTimeout(() => {
    hello.classList.add('gone');
    reveal();
    setTimeout(() => hello.remove(), 750);
  }, 1500);
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

/* Claim-your-access — INVITE-ONLY. A manager issues a one-time code and
   sends it to the person; that code plus a policy-passing password of
   their own gets them in. The password never leaves here in plaintext
   except to memberClaim, which stores only the hash. */
function pwScore(pw) {
  // 0 fails policy · 1 weak · 2 okay · 3 good · 4 strong
  const num = /[0-9]/.test(pw), sym = /[^A-Za-z0-9]/.test(pw);
  if (pw.length < 10 || !num || !sym) return 0;
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (pw.length >= 15) s++;
  return s;
}
const PW_LABEL = ['Needs 10+ characters, a number and a symbol', 'Weak — it passes, barely', 'Okay', 'Good', 'Strong'];

function claimDialog() {
  const tri = textInput({ maxLength: 3, placeholder: 'TRI', style: { textTransform: 'uppercase' } });
  const inv = textInput({ maxLength: 20, placeholder: 'XXXXX-XXXXX', style: { textTransform: 'uppercase' } });
  const c1 = h('input', { type: 'password', maxLength: 64, placeholder: '10+ chars, a number, a symbol' });
  const c2 = h('input', { type: 'password', maxLength: 64, placeholder: 'Same again' });
  const bars = [0, 1, 2, 3].map(() => h('span', { class: 'pw-bar' }));
  const meterLbl = h('span', { class: 'pw-label' }, PW_LABEL[0]);
  const meter = h('div', { class: 'pw-meter' }, h('div', { class: 'pw-bars' }, ...bars), meterLbl);
  c1.addEventListener('input', () => {
    const s = pwScore(c1.value);
    bars.forEach((b, i) => { b.className = 'pw-bar' + (i < s ? ` on s${s}` : ''); });
    meterLbl.textContent = PW_LABEL[s];
    meter.dataset.score = s;
  });
  modal('Activate Your CAPCOM Account',
    h('div', { class: 'form' },
      h('p', { class: 'sub' }, 'Enter the activation code your manager sent you, then create your password. The code works once and expires after 7 days.'),
      field('Your trigram', tri, 'The same three letters you use in the REC Room.'),
      field('Activation code', inv),
      field('Create your password', c1),
      meter,
      field('Confirm it', c2)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Activate', kind: 'accent', onClick: async c => {
        if (pwScore(c1.value) < 1) { toast('Passwords need 10+ characters, a number and a symbol', 'err'); return; }
        if (c1.value !== c2.value) { toast('The two passwords do not match', 'err'); return; }
        try {
          const r = await api.memberClaim({ trigram: tri.value, invite: inv.value, code: c1.value });
          c();
          toast(`Welcome, ${r.name} — signing you in`);
          try { sessionStorage.setItem('capcom.tour.pending', '1'); } catch {}
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
    if (!/^[A-Z]{3}$/.test(tri) || !code) { toast('Trigram (3 letters) and your staff password. First time? Use the activation button below — your activation code is not a password.', 'err'); return; }
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
