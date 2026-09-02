/* tour.js — the first-run guided walkthrough. A spotlight ring and a
   card that glitch in over each widget, one short blurb per stop, a
   tiny synth blip per step. Starts automatically once, right after a
   member finishes setting up their account (sessionStorage handoff
   from the gate); replays any time from Help. "Skip all tutorials"
   turns it off for good on this browser.

   Glitch discipline: the entrance jitters for ~0.4s and then SETTLES —
   text is never animated while someone is trying to read it. And
   prefers-reduced-motion turns the whole act into a plain fade. */
import { h } from './util.js';

const TOUR_KEY = 'capcom.tour'; // '', 'done', or 'off' (skip all)

/* Every stop names a [data-tour] hook. Stops whose element is not on
   the page (scoped away, or a different route) are skipped silently —
   the same list serves every key shape. */
export const TOUR_STEPS = [
  { hook: 'nav', title: 'The sidebar', blurb: 'Every area you can open lives here — Mission Control, Projects, the REC Room. What you see depends on your access.' },
  { hook: 'calendar', title: 'Calendar', blurb: 'What is on this week across enablement — the same feed the Mission Control pages read.' },
  { hook: 'projects-glance', title: 'Projects at a glance', blurb: 'The Project Board, compressed: what is moving, what is overdue, and the next deadline coming at you.' },
  { hook: 'changes', title: 'Change feed', blurb: 'Everything anyone changes, signed and timestamped. Nothing here happens quietly.' },
  { hook: 'clock', title: 'Operations clock', blurb: 'Local time plus the four hub clocks — New York, São Paulo, London, Bangalore.' },
  { hook: 'board', title: 'Community Board', blurb: 'The corkboard. Pin notes, bookmarks and pictures, tie them together with yarn, react to things. It is signed — the board shows people.' },
  { hook: 'news', title: 'Enablement News', blurb: 'One quiet line of sales-enablement and AI reading, rotating on its own. Open the caret for the full list.' },
  { hook: 'theme', title: 'Light and dark', blurb: 'CAPCOM in the theme you prefer — it remembers per browser.' },
  { hook: 'help', title: 'Help & FAQ', blurb: 'Short blurbs on every area, the FAQ, bug reports — and this walkthrough, any time you want it again.' },
];

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

let live = null; // { veil, ring, card, idx, steps }

export function endTour(how) {
  if (!live) return;
  try { localStorage.setItem(TOUR_KEY, how === 'off' ? 'off' : 'done'); } catch {}
  blip(how === 'off' ? 'off' : 'end');
  const { veil, ring, card } = live;
  ring.classList.add('tour-out'); card.classList.add('tour-out');
  live = null;
  setTimeout(() => { veil.remove(); ring.remove(); card.remove(); }, 320);
}

/* A target that exists but is not really on screen (the drawer nav on a
   phone, a scoped-away card) must be SKIPPED, not spotlit — a ring
   around nothing reads as a broken tour. */
function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 24 && r.height > 10 && r.right > 0 && r.left < window.innerWidth
    && getComputedStyle(el).visibility !== 'hidden';
}

function place(step, idx, steps) {
  const el = document.querySelector(`[data-tour="${step.hook}"]`);
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

export function startTour(force) {
  if (live) return;
  try { if (!force && localStorage.getItem(TOUR_KEY)) return; } catch {}
  const steps = TOUR_STEPS.filter(s => {
    const el = document.querySelector(`[data-tour="${s.hook}"]`);
    return el && visible(el);
  });
  if (!steps.length) return;
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
  live = { veil, ring, card, idx: 0, prev: -1, steps };
  const onResize = () => { if (live) place(live.steps[live.idx], live.idx, live.steps); };
  window.addEventListener('resize', onResize);
  veil.addEventListener('click', () => endTour('done'));
  show(0);
}

/* The gate sets capcom.tour.pending when an invite is redeemed; Home
   calls this after it mounts. First-timers get the tour exactly once. */
export function maybeAutoStart() {
  let pending = false;
  try {
    pending = sessionStorage.getItem('capcom.tour.pending') === '1';
    if (pending) sessionStorage.removeItem('capcom.tour.pending');
  } catch {}
  let seen = null;
  try { seen = localStorage.getItem(TOUR_KEY); } catch {}
  if (pending && seen !== 'off') { setTimeout(() => startTour(true), 600); }
}
