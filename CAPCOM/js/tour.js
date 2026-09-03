/* tour.js — guided walkthroughs, one per page. A spotlight ring and a
   card glitch in over each component, a short blurb and a synth blip
   per step. Each page's tour runs automatically the FIRST time that
   page is opened (per browser), and can be replayed from Help; "Skip
   all tutorials" silences every page at once.

   Steps resolve three ways: `hook` ([data-tour] attributes — Home),
   `card` (a .card whose section title matches — survives redesigns
   better than nth-child), or `sel` (a CSS selector). Steps whose
   element is missing or off-screen are skipped, so one list serves
   every key shape.

   Glitch discipline: the entrance jitters for ~0.4s and then SETTLES —
   text is never animated while someone is trying to read it. And
   prefers-reduced-motion turns the whole act into a plain fade. */
import { h } from './util.js';

const KEY = 'capcom.tour'; // JSON {off, done:{route:true}} — legacy strings migrate

export const TOURS = {
  home: [
    { hook: 'nav', title: 'The Sidebar', blurb: 'Every area you can open lives here — Mission Control, Projects, the REC Room. What you see depends on your access.' },
    { hook: 'calendar', title: 'Calendar', blurb: 'What is on this week across enablement — the same feed the Mission Control pages read.' },
    { hook: 'projects-glance', title: 'Projects At A Glance', blurb: 'The Project Board, compressed: what is moving, what is overdue, and the next deadline coming at you.' },
    { hook: 'changes', title: 'Change Feed', blurb: 'Everything anyone changes, signed and timestamped. Nothing here happens quietly.' },
    { hook: 'clock', title: 'Operations Clock', blurb: 'Local time plus the four hub clocks — New York, São Paulo, London, Bangalore.' },
    { hook: 'board', title: 'Community Board', blurb: 'The corkboard. Pin notes, bookmarks and pictures, tie them together with yarn, react to things. Signed with real names.' },
    { hook: 'news', title: 'Enablement News', blurb: 'One quiet line of sales-enablement and AI reading, rotating on its own. Open the caret for the full list.' },
    { hook: 'theme', title: 'Light And Dark', blurb: 'CAPCOM in the theme you prefer — it remembers per browser.' },
    { hook: 'help', title: 'Help & FAQ', blurb: 'Short blurbs on every area, the FAQ, bug reports — and every walkthrough, any time you want one again.' },
  ],
  projects: [
    { sel: '.view .tiles', title: 'The Two Numbers', blurb: 'Active projects and how many are overdue. Everything else on this page exists to keep the second number at zero.' },
    { card: 'Project Board', title: 'The Board', blurb: 'Every project, its team, its people, its status — and the date that status promised. Filter by team or status above the table.' },
    { sel: '.view table', title: 'A Project Row', blurb: 'Diary reads the project’s history; Status moves it and always asks for a date. An OVERDUE row demands a written what-happened before it moves again.' },
  ],
  'projects/insights': [
    { card: 'Projects — Insights & Calendar', title: 'The Donuts', blurb: 'The board summarized — how work is distributed right now.' },
    { card: 'Phase timeline', title: 'Phase Timeline', blurb: 'Every active project as a bar to its promised date — the Gantt view of the quarter.' },
    { card: 'Projects calendar', title: 'Projects Calendar', blurb: 'Phase deadlines and milestones on their own calendar — deliberately separate from Mission Control’s.' },
    { card: 'Diary review', title: 'Diary Review', blurb: 'The append-only project diary, filterable by quarter — what management reads to see how the quarter actually went.' },
  ],
  'projects/staff': [
    { card: 'Staff', title: 'The Org Tree', blurb: 'Sales Enablement, top level down — every report indented under their leader. Staff only; SMEs get keys instead.' },
    { sel: '.cat-invite', title: 'Invite', blurb: 'Makes a one-time access code for that person — send it to them yourself. It also works as a password reset.' },
    { sel: '.staff-access-bar', title: 'Not Staff?', blurb: 'SMEs and outside contributors get a scoped key from Tailored Access, not a staff entry.' },
  ],
  'projects/access': [
    { card: 'Tailored Access', title: 'Tailored Access', blurb: 'Scoped keys for SMEs and outside contributors. A key opens exactly the areas it names and nothing else — and it shows in full exactly once.' },
  ],
  calendar: [
    { sel: '.view > .sec-title', title: 'The Enablement Calendar', blurb: 'The events behind the Mission Control pages. + New Event adds one; categories keep the colors meaningful.' },
    { sel: '.view .card', title: 'A Month', blurb: 'Click any event to edit or retire it. Changes reach the live pages within a minute.' },
  ],
  'banners/highlights': [
    { sel: '.view .card', title: 'Focused Headlines', blurb: 'The rotating hero banners sellers see first on Mission Control. Order, copy, art and CTAs are all editable here.' },
  ],
  'banners/stellar': [
    { sel: '.view .card', title: 'Action Banner', blurb: 'The Stellar-Seller action banner set — same mechanics as Focused Headlines, different stage.' },
  ],
  dashboard: [
    { card: 'Systems', title: 'Systems Watch', blurb: 'Live health of everything the apps stand on — database, feeds, partners, the room. Green means verified just now.' },
    { card: 'Game Masters', title: 'Game Masters', blurb: 'The worldwide top three. Hover a trigram for the full read.' },
    { card: 'Runs per day — last 30 days', title: 'Runs Per Day', blurb: 'Play volume over the last month — launches and pushes show up here first.' },
    { card: 'Recent runs', title: 'Recent Runs', blurb: 'The latest scores as they land, newest first.' },
  ],
  players: [
    { sel: '.view .card', title: 'Players', blurb: 'Everyone the arcade has seen, with runs, accuracy and territory. The filter box narrows by trigram or country.' },
  ],
  questions: [
    { sel: '.view .tabs', title: 'Three Banks', blurb: 'Knowledge, methodology and glossary — the pools every game draws from.' },
    { sel: '.view .card', title: 'The Bank', blurb: 'Each row shows how often a question is attempted and missed. Retire rather than delete — history stays.' },
  ],
  maintenance: [
    { card: 'REC Room maintenance', title: 'The Room Switch', blurb: 'BE RIGHT BACK for the whole arcade — closes play and rejects scores until reopened. It fails open on any error.' },
    { card: 'Keys & Services', title: 'Keys & Services', blurb: 'The service keys the apps run on. Values set here apply within a minute, no deploy.' },
    { card: 'Setup', title: 'Setup', blurb: 'Creates and upgrades every table, and seeds what is missing. Safe to run any number of times.' },
  ],
};

function tourState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { off: false, done: {} };
    if (raw === 'off') return { off: true, done: {} };
    if (raw === 'done') return { off: false, done: { home: true } };
    const o = JSON.parse(raw);
    return { off: !!o.off, done: o.done || {} };
  } catch { return { off: false, done: {} }; }
}
function saveState(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
export function resetTours() { saveState({ off: false, done: {} }); }

let ac = null;
function blip(kind) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square';
    if (kind === 'end') { o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(920, t + 0.09); }
    else if (kind === 'off') { o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.12); }
    else { o.frequency.setValueAtTime(560 + (kind | 0) * 45, t); o.frequency.exponentialRampToValueAtTime(660 + (kind | 0) * 45, t + 0.03); }
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.13);
  } catch { /* no audio is fine */ }
}

let live = null; // { veil, ring, card, idx, prev, steps, route }

/* A target that exists but is not really on screen (a drawer nav on a
   phone, a scoped-away card) must be SKIPPED, not spotlit. */
function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 24 && r.height > 10 && r.right > 0 && r.left < window.innerWidth
    && getComputedStyle(el).visibility !== 'hidden';
}

function findStep(s) {
  if (s.hook) return document.querySelector(`[data-tour="${s.hook}"]`);
  if (s.card) {
    return [...document.querySelectorAll('.view .card')].find(c => {
      const t = c.querySelector('.sec-title h2');
      return t && t.textContent.trim() === s.card;
    }) || null;
  }
  if (s.sel) return document.querySelector(s.sel);
  return null;
}

/* Tear the overlay down with NO state write — a route change mid-tour
   must not mark the page done or off. */
export function killTour() {
  if (!live) return;
  const { veil, ring, card } = live;
  live = null;
  veil.remove(); ring.remove(); card.remove();
}

export function endTour(how) {
  if (!live) return;
  const st = tourState();
  if (how === 'off') st.off = true; else st.done[live.route] = true;
  saveState(st);
  blip(how === 'off' ? 'off' : 'end');
  const { veil, ring, card } = live;
  ring.classList.add('tour-out'); card.classList.add('tour-out');
  live = null;
  setTimeout(() => { veil.remove(); ring.remove(); card.remove(); }, 320);
}

function place(step, idx, steps) {
  const el = findStep(step);
  if (!el || !visible(el)) return false;
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  const { ring, card } = live;
  // measure after the scroll settles — never via rAF (hidden frames starve it)
  setTimeout(() => {
    if (!live) return;
    const r = el.getBoundingClientRect();
    const pad = 8, vw = window.innerWidth, vh = window.innerHeight;
    Object.assign(ring.style, {
      left: (r.left - pad) + 'px', top: (r.top - pad) + 'px',
      width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px',
    });
    // content first, so the card's real height can drive placement
    card.querySelector('.tour-step').textContent = `${idx + 1} / ${steps.length}`;
    card.querySelector('.tour-title').textContent = step.title;
    card.querySelector('.tour-blurb').textContent = step.blurb;
    card.querySelector('.tour-back').disabled = idx === 0;
    card.querySelector('.tour-next').textContent = idx === steps.length - 1 ? 'Finish' : 'Next →';
    const cw = Math.min(340, vw - 24);
    card.style.width = cw + 'px';
    card.style.bottom = '';
    const ch = card.offsetHeight || 180;
    // below the target, else above, else (tall target) beside it — clamped
    const clampL = v => Math.max(12, Math.min(v, vw - cw - 12));
    const clampT = v => Math.max(12, Math.min(v, vh - ch - 12));
    let left = clampL(r.left), top;
    if (r.bottom + ch + 22 < vh) top = r.bottom + pad + 10;
    else if (r.top - ch - 22 > 0) top = r.top - ch - pad - 10;
    else {
      top = clampT((vh - ch) / 2);
      left = (r.right + cw + 26 < vw) ? r.right + pad + 10 : clampL(r.left - cw - pad - 10);
    }
    // one atomic write, so no partial geometry ever paints
    card.style.cssText = `width:${cw}px;left:${left}px;top:${clampT(top)}px`;
    ring.classList.remove('tour-in'); card.classList.remove('tour-in');
    void ring.offsetWidth; // restart the glitch
    ring.classList.add('tour-in'); card.classList.add('tour-in');
  }, 180);
  return true;
}

function show(idx) {
  if (!live) return;
  const steps = live.steps;
  if (idx < 0) idx = 0;
  if (idx >= steps.length) { endTour('done'); return; }
  live.idx = idx;
  blip(idx);
  if (!place(steps[idx], idx, steps)) {
    // element missing on this page — walk on in the same direction
    const dir = idx >= (live.prev ?? -1) ? 1 : -1;
    live.prev = idx;
    show(idx + dir);
    return;
  }
  live.prev = idx;
}

export function startTour(route, force) {
  if (live) return true;
  const st = tourState();
  if (!force && (st.off || st.done[route])) return true;
  const all = TOURS[route] || [];
  const steps = all.filter(s => { const el = findStep(s); return el && visible(el); });
  if (!steps.length) return false;
  const veil = h('div', { class: 'tour-veil' });
  const ring = h('div', { class: 'tour-ring' });
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-label': 'Guided walkthrough' },
    h('div', { class: 'tour-head' },
      h('span', { class: 'tour-step' }, ''),
      h('button', { class: 'tour-skip', onClick: () => endTour('off') }, 'Skip all tutorials')),
    h('div', { class: 'tour-title' }, ''),
    h('div', { class: 'tour-blurb' }, ''),
    h('div', { class: 'tour-btns' },
      h('button', { class: 'btn sm tour-back', onClick: () => show(live.idx - 1) }, '← Back'),
      h('button', { class: 'btn sm accent tour-next', onClick: () => show(live.idx + 1) }, 'Next →')));
  document.body.append(veil, ring, card);
  live = { veil, ring, card, idx: 0, prev: -1, steps, route };
  window.addEventListener('resize', () => { if (live) place(live.steps[live.idx], live.idx, live.steps); });
  veil.addEventListener('click', () => endTour('done'));
  show(0);
  return true;
}

/* Called after every route mount. A page's tour runs the FIRST time
   that page is opened, unless tutorials are off. Views load their
   content async, so a start that finds nothing retries once. The gate
   sets capcom.tour.pending when an invite is redeemed — that forces
   Home's tour even if it somehow ran before. */
export function maybeAutoStart(route) {
  let pending = false;
  try {
    pending = sessionStorage.getItem('capcom.tour.pending') === '1';
    if (pending && route === 'home') sessionStorage.removeItem('capcom.tour.pending');
  } catch {}
  const st = tourState();
  if (st.off) return;
  const force = pending && route === 'home';
  if (!force && (st.done[route] || !TOURS[route])) return;
  setTimeout(() => {
    if (!startTour(route, force)) setTimeout(() => startTour(route, force), 1600);
  }, 900);
}
