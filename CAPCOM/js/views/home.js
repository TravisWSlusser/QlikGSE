/* home.js — CAPCOM's landing screen.

   Layout: quick actions (Mission Control content only — the rare/dangerous
   actions were deliberately removed so nothing tempts), then the calendar
   widget rebuild beside the operations clocks, the change feed, and one
   STELLAR-SELLER widget that folds together everything Side-Qlik: the
   recent-scores ticker, the leaders (hover a trigram for a live stat card),
   the most-missed questions, and the Stellar edit hotlinks.

   Every card degrades by scope; a card a key can't open doesn't render. */
import { h, clear, fmt, isPast, esc } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState, toast, modal, confirmBox, field, textInput } from '../ui.js';
import { ICONS } from '../icons.js';
import { wirePop } from '../pop.js';

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let ME = null; // the signed-in member's name — signatures come from the credential

export function render(params, rerender, who) {
  const scopes = (who && who.scopes) || [];
  ME = (who && who.member && who.member.name) || null;
  const root = h('div', { class: 'view' });

  // ── the hotlinks bar — shared quick nav, any key can add to it ──
  const linkBar = h('div', { class: 'hlk-bar' }, spinner());
  root.appendChild(linkBar);
  loadHotlinks(linkBar, rerender);

  // Quick actions live under the calendar now, not in a top row.
  const acts = [];
  const act = (icon, label, hash) => h('a', { class: 'qa qa-sm', href: hash },
    h('span', { class: 'qa-ic', html: ICONS[icon] || '' }), label);
  if (scopes.includes('calendar')) acts.push(act('calendar', 'New event', '#calendar/new'));
  if (scopes.includes('banners')) acts.push(act('banners', 'New headline', '#banners/highlights/new'));
  if (scopes.includes('projects')) acts.push(act('projects', 'New project', '#projects/new'));

  // Two columns: calendar (with its actions) left; clock over changes right.
  const grid = h('div', { class: 'grid2 home-cols' });
  root.appendChild(grid);

  const leftCol = h('div', { class: 'home-col' });
  const rightCol = h('div', { class: 'home-col' });
  grid.append(leftCol, rightCol);

  // Left column: calendar (with actions), projects at a glance, change feed.
  const calCard = h('div', { class: 'card', dataset: { tour: 'calendar' } }, spinner());
  leftCol.appendChild(calCard);
  loadCalendar(calCard, scopes, acts);
  const prjCard = h('div', { class: 'card', dataset: { tour: 'projects-glance' } }, spinner());
  leftCol.appendChild(prjCard);
  loadProjectsCard(prjCard, scopes);
  // the Leadership Brief teaser — managers and masters only
  if (who && (who.master || who.manager)) {
    const briefCard = h('div', { class: 'card' }, spinner());
    leftCol.appendChild(briefCard);
    loadBriefCard(briefCard);
  }
  const logCard = h('div', { class: 'card', dataset: { tour: 'changes' } }, spinner());
  leftCol.appendChild(logCard);
  loadLog(logCard);

  // Right column: clock, the corkboard, then the Enablement News Feed.
  rightCol.appendChild(clockCard());
  const board = h('div', { class: 'card board-card', dataset: { tour: 'board' } }, spinner());
  rightCol.appendChild(board);
  loadBoard(board, rerender);
  const inspo = h('div', { class: 'card', dataset: { tour: 'news' } }, spinner());
  rightCol.appendChild(inspo);
  loadInspoCard(inspo);

  // ── the Stellar-Seller widget — full width under the grid ──
  if (scopes.some(s => ['analytics', 'content', 'banners'].includes(s))) {
    const ss = h('div', { class: 'card ss-widget' }, spinner());
    root.appendChild(ss);
    loadStellar(ss, scopes);
  }

  return root;
}

/* ── operations clocks — the Mission Control set, recreated ──
   Local time large, then the four hub clocks (New York, São Paulo, London,
   Singapore) analog + digital, ordered furthest-ahead first, night hours
   dimmed — same rules as the homepage widget. */
const ZONES = [
  { country: 'UNITED STATES', city: 'New York', tz: 'America/New_York' },
  { country: 'BRAZIL', city: 'São Paulo', tz: 'America/Sao_Paulo' },
  { country: 'UNITED KINGDOM', city: 'London', tz: 'Europe/London' },
  { country: 'SINGAPORE', city: 'Singapore', tz: 'Asia/Singapore' },
];
const CLOCK_SVG = '<svg class="cl" viewBox="0 0 100 100" aria-hidden="true">'
  + '<circle class="cl-ring" cx="50" cy="50" r="46"/>'
  + '<line class="cl-h" x1="50" y1="50" x2="50" y2="30"/>'
  + '<line class="cl-m" x1="50" y1="50" x2="50" y2="20"/>'
  + '<circle class="cl-hub" cx="50" cy="50" r="2.6"/></svg>';

function tzParts(tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date());
  const get = t => Number((p.find(x => x.type === t) || {}).value || 0);
  return { hh: get('hour'), mm: get('minute') };
}
function tzOffsetMin(tz) {
  const now = new Date();
  const loc = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((loc - utc) / 60000);
}

function clockCard() {
  const greeting = h('div', { class: 'lk-greet' });
  const localTime = h('div', { class: 'lk-time' });
  const localDate = h('div', { class: 'lk-date' });
  const zones = ZONES.slice().sort((a, b) => tzOffsetMin(b.tz) - tzOffsetMin(a.tz));
  const zoneEls = zones.map(z => {
    const el = h('div', { class: 'clk' },
      h('span', { class: 'clk-face', html: CLOCK_SVG }),
      h('div', { class: 'clk-txt' },
        h('div', { class: 'clk-country' }, z.country),
        h('div', { class: 'clk-city' }, z.city),
        h('div', { class: 'clk-time' })));
    el._tz = z.tz;
    return el;
  });
  const card = h('div', { class: 'card clock-card', dataset: { tour: 'clock' } },
    sectionTitle('Operations clock'),
    greeting, localTime, localDate,
    h('div', { class: 'clk-grid' }, zoneEls));

  const tick = () => {
    const now = new Date();
    // Mission Control's greeting rules, verbatim: <12 morning, <18 afternoon.
    const hr = now.getHours();
    greeting.textContent = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    localTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    localDate.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    for (const el of zoneEls) {
      const { hh, mm } = tzParts(el._tz);
      const hAng = ((hh % 12) + mm / 60) * 30, mAng = mm * 6;
      const face = el.children[0];
      const svg = face.firstElementChild;
      if (svg && svg.children) {
        for (const c of svg.children) {
          const cls = (c.getAttribute && c.getAttribute('class')) || '';
          if (cls === 'cl-h') c.setAttribute('transform', `rotate(${hAng} 50 50)`);
          if (cls === 'cl-m') c.setAttribute('transform', `rotate(${mAng} 50 50)`);
        }
      }
      el.children[1].children[2].textContent =
        new Intl.DateTimeFormat('en-US', { timeZone: el._tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
      el.classList.toggle('night', hh < 7 || hh >= 21);
    }
  };
  // First paint runs UNCONDITIONALLY — at build time the card is not yet in
  // the document, and an isConnected guard here killed the clock at birth
  // (blank greeting, frozen time). The liveness check belongs only inside
  // the interval, where "no longer connected" genuinely means "view gone".
  const timer = setInterval(() => {
    if (!card.isConnected) { clearInterval(timer); return; }
    tick();
  }, 1000);
  tick();
  return card;
}

/* ── the hotlinks bar ── */
async function loadHotlinks(bar, rerender) {
  let d;
  try { d = await api.hotlinks({ op: 'list' }); }
  catch { clear(bar); return; } // a broken bar is not worth an error card
  clear(bar);
  for (const l of d.links || []) {
    const pill = h('span', { class: 'hlk' },
      h('a', { href: l.href, target: '_blank', rel: 'noopener' }, l.label, h('i', null, ' ↗')),
      h('button', {
        class: 'hlk-x', 'aria-label': `Remove ${l.label}`, title: 'Remove',
        onClick: () => confirmBox('Remove this link?', `“${l.label}” disappears from everyone's bar.`, async () => {
          try { await api.hotlinks({ op: 'delete', id: l.id }); toast('Link removed'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Remove it'),
      }, '✕'));
    bar.appendChild(pill);
  }
  bar.appendChild(h('button', {
    class: 'hlk-add', onClick: () => {
      const label = textInput({ maxLength: 30, placeholder: 'Sales Hub' });
      const href = textInput({ maxLength: 500, placeholder: 'https://…' });
      modal('Add a hotlink',
        h('div', { class: 'form' },
          field('Label', label),
          field('Link', href, 'Shows on every leader’s Home bar.')),
        [
          { label: 'Cancel', onClick: c => c() },
          { label: 'Add', kind: 'accent', onClick: async c => {
            try { await api.hotlinks({ op: 'save', label: label.value, href: href.value }); c(); toast('Link added'); rerender(); }
            catch (err) { toast(err.message, 'err'); }
          } },
        ]);
    },
  }, '+ Add link'));
}

/* ── the community corkboard, v2 ──
   Multiple boards behind ‹ › arrows. Two kinds of item with different
   physics: paper NOTES (pinned, permanent, rotatable, collect signed
   reactions on their corner) and bare STICKERS (no pin, no paper — signed
   with a real name, expiring 24h after pinning, rotatable AND scalable).
   Transforms are shared state: turn your sticker and everyone sees it
   turned. The change feed polices pins and takedowns; nudges go unlogged. */

const NAME_STORE = 'capcom.boardname';
const rememberName = v => { try { localStorage.setItem(NAME_STORE, v); } catch {} };
const recallName = () => { try { return localStorage.getItem(NAME_STORE) || ''; } catch { return ''; } };

let boardNo = (() => { try { return Number(localStorage.getItem('capcom.board')) || 1; } catch { return 1; } })();

let notePopEl = null;
function notePop() {
  if (!notePopEl) { notePopEl = h('div', { id: 'note-pop' }); document.body.appendChild(notePopEl); }
  return notePopEl;
}
function hideNotePop() { if (notePopEl) notePopEl.style.display = 'none'; }
function placePop(e, anchor) {
  e.style.display = 'block';
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 100, bottom: 100, top: 80 };
  const w = e.offsetWidth || 300;
  let x = Math.min(r.left, window.innerWidth - w - 16);
  let y = r.bottom + 8;
  if (y + (e.offsetHeight || 160) > window.innerHeight - 8) y = Math.max(8, r.top - (e.offsetHeight || 160) - 8);
  e.style.left = x + 'px'; e.style.top = y + 'px';
}

async function loadBoard(card, rerender) {
  hideXfPad(false); // a re-render orphans the pad's anchor; drop any preview
  hideYarnPad();
  setTie(null);
  let d;
  try { d = await api.stickies({ op: 'list', board: boardNo }); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadBoard(card, rerender))); return; }
  clear(card);

  const reload = () => loadBoard(card, rerender);
  const boards = d.boards || 5;
  const unlocked = d.unlocked || 1;
  const caps = d.caps || { items: 18, stickers: 10, unlockAt: 9 };
  // The wall is earned: board N+1 opens when board N is half full.
  const go = n => {
    if (n < 1) n = 1;
    if (n > unlocked) {
      toast(`Board ${n} is locked — fill board ${unlocked} to ${caps.unlockAt} items to open it (${d.count || 0}/${caps.unlockAt})`, 'err');
      return;
    }
    boardNo = Math.min(boards, n);
    try { localStorage.setItem('capcom.board', String(boardNo)); } catch {}
    reload();
  };
  if (boardNo > unlocked) { boardNo = unlocked; } // stored board can outrun a thinned wall

  const nextLocked = unlocked < boards && boardNo === unlocked;
  card.appendChild(sectionTitle('The Community Board',
    h('span', { class: 'bd-fill', title: `${d.count || 0} of ${caps.items} items · next board opens at ${caps.unlockAt}` },
      `${d.count || 0}/${caps.items}`),
    h('span', { class: 'bd-nav' },
      h('button', { class: 'btn xs', 'aria-label': 'Previous board', disabled: boardNo <= 1 ? 'disabled' : null, onClick: () => go(boardNo - 1) }, '‹'),
      h('span', { class: 'bd-no' }, `${boardNo} / ${boards}`),
      h('button', {
        class: 'btn xs' + (nextLocked ? ' bd-lock' : ''),
        'aria-label': 'Next board',
        title: nextLocked ? `Unlocks at ${caps.unlockAt} items on this board` : null,
        onClick: () => go(boardNo + 1),
      }, nextLocked ? '🔒' : '›')),
    h('button', { class: 'btn sm', onClick: () => linkDialog(reload) }, '+ Link'),
    h('button', { class: 'btn sm', onClick: () => stickerDialog(reload) }, '+ Sticker'),
    h('button', { class: 'btn sm accent', onClick: () => noteDialog(reload) }, '+ Note')));

  const notes = d.notes || [];
  const reactsBy = {};
  for (const r of d.reactions || []) (reactsBy[r.sticky_id] = reactsBy[r.sticky_id] || []).push(r);

  const cork = h('div', { class: 'cork cork-free' });
  card.appendChild(cork);
  if (!notes.length) {
    redrawYarn = () => {};
    cork.appendChild(h('p', { class: 'cork-empty' }, `Board ${boardNo} is bare. Pin something.`));
    return;
  }

  // Board context the item menus read at open time: current yarn, the
  // items by id (for labeling the other end of a string), and reload.
  const bd = { yarn: d.yarn || [], items: {}, reload };
  for (const n of notes) bd.items[n.id] = n;

  // Layering: the latest pin sits on top. Rows arrive newest-first, so the
  // base z-index descends through the list; interaction bumps ride above.
  const itemEls = new Map();
  notes.forEach((n, i) => {
    const el = n.sticker_url ? stickerItem(n, cork, reload, bd)
      : n.link_url ? bookmarkItem(n, reactsBy[n.id] || [], cork, reload, bd)
      : noteItem(n, reactsBy[n.id] || [], cork, reload, bd);
    el.style.zIndex = String(notes.length - i);
    itemEls.set(n.id, el);
    cork.appendChild(el);
  });

  // The yarn layer: an SVG sheet over the whole cork, never interactive —
  // strings drape over the paper like the real thing. Endpoints are read
  // from the items' live boxes, so a drag re-aims the string in real time.
  // A tie remembers WHERE on each item it was pinned (anchor fractions);
  // yarn without anchors (tied before that existed) clips to the item's
  // EDGE along the string's direction instead of skewering the center.
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'yarn-layer');
  cork.appendChild(svg);
  const edgePoint = ([cx, cy], [tx, ty], r) => {
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const sx = dx ? ((dx > 0 ? r.right : r.left) - cx) / dx : Infinity;
    const sy = dy ? ((dy > 0 ? r.bottom : r.top) - cy) / dy : Infinity;
    const s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  };
  redrawYarn = () => {
    const cr = cork.getBoundingClientRect();
    if (!cr.width) return; // view is gone; a stale resize tick lands here
    svg.setAttribute('viewBox', `0 0 ${cr.width} ${cr.height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const yr of bd.yarn) {
      const a = itemEls.get(yr.from_id), b = itemEls.get(yr.to_id);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const boxA = { left: ra.left - cr.left, top: ra.top - cr.top, right: ra.right - cr.left, bottom: ra.bottom - cr.top };
      const boxB = { left: rb.left - cr.left, top: rb.top - cr.top, right: rb.right - cr.left, bottom: rb.bottom - cr.top };
      const cA = [(boxA.left + boxA.right) / 2, (boxA.top + boxA.bottom) / 2];
      const cB = [(boxB.left + boxB.right) / 2, (boxB.top + boxB.bottom) / 2];
      const at = (box, ax, ay) => [box.left + (box.right - box.left) * ax, box.top + (box.bottom - box.top) * ay];
      const anchA = yr.from_ax != null ? at(boxA, yr.from_ax, yr.from_ay) : null;
      const anchB = yr.to_ax != null ? at(boxB, yr.to_ax, yr.to_ay) : null;
      const [x1, y1] = anchA || edgePoint(cA, anchB || cB, boxA);
      const [x2, y2] = anchB || edgePoint(cB, anchA || cA, boxB);
      const hex = YARN_HEX[yr.color] || YARN_HEX.red;
      const sag = Math.min(46, Math.hypot(x2 - x1, y2 - y1) * 0.16) + (yr.id % 4) * 3;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag} ${x2} ${y2}`);
      path.setAttribute('stroke', hex);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
      for (const [px, py] of [[x1, y1], [x2, y2]]) {
        const pin = document.createElementNS(svgNS, 'circle');
        pin.setAttribute('cx', px); pin.setAttribute('cy', py); pin.setAttribute('r', '3.5');
        pin.setAttribute('fill', hex);
        pin.setAttribute('stroke', 'rgba(0,0,0,.4)');
        svg.appendChild(pin);
      }
    }
  };
  redrawYarn();
}

/* ── direct manipulation: the touch-wall engine ──
   The board is free space. Every item carries pos_x/pos_y (percent of the
   cork, shared state like rotation and scale), and the interactions read
   like a touch screen:

   press-and-hold (~300ms)  lift the item, drag anywhere, release to place
   right-click              menu: react (notes) / scale (stickers) / rotate
                            / take down — Scale and Rotate open a small
                            button pad on screen: − + or ‹ › nudge the
                            item live; ✓ or any click off the pad confirms

   One transform write per gesture — drags save on release, the pad saves
   on confirm (and only if something changed); Escape reverts. */

let zTop = 10; // interacted items float; not persisted, recency is enough

function itemPos(n) {
  // Deterministic first placement for items that predate free positioning —
  // seeded by id so every viewer sees the same arrangement.
  if (n.pos_x == null || n.pos_y == null) {
    n.pos_x = 6 + (n.id * 37) % 58;
    n.pos_y = 6 + (n.id * 53) % 52;
  }
  return n;
}

function applyXf(el, n) {
  el.style.left = n.pos_x + '%';
  el.style.top = n.pos_y + '%';
  el.style.transform = `rotate(${n.rotation || 0}deg) scale(${n.scale || 1})`;
}

async function saveXf(n) {
  try {
    await api.stickies({
      op: 'transform', id: n.id,
      rotation: Math.round(n.rotation || 0), scale: n.scale || 1,
      pos_x: n.pos_x, pos_y: n.pos_y,
    });
  } catch { /* the next list re-syncs; a lost nudge is not an incident */ }
}

/* the custom right-click menu — one shared element */
let ctxEl = null;
function ctxMenu(x, y, entries) {
  if (!ctxEl) {
    ctxEl = h('div', { id: 'ctx-menu' });
    document.body.appendChild(ctxEl);
    document.addEventListener('click', () => { if (ctxEl) ctxEl.style.display = 'none'; });
  }
  clear(ctxEl).append(...entries.map(([label, fn, danger]) =>
    h('button', { class: 'ctx-item' + (danger ? ' danger' : ''), onClick: () => { ctxEl.style.display = 'none'; fn(); } }, label)));
  ctxEl.style.display = 'block';
  ctxEl.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  ctxEl.style.top = Math.min(y, window.innerHeight - entries.length * 40 - 12) + 'px';
}

/* ── sounds: tiny WebAudio pops for pick up, put down, and react.
   Synthesized on the spot — no files to load — and played through an
   AudioContext rather than <audio>, because media elements put a phantom
   player on the iOS lock screen (the REC Room lesson); a context has no
   media session. Every call rides a user gesture, so autoplay is happy. */
let audioCtx = null;
function pop(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    const [f0, f1, dur, vol] =
      kind === 'up' ? [300, 640, 0.09, 0.2]        // plucked off the cork
      : kind === 'down' ? [560, 260, 0.12, 0.24]   // pressed back on
      : [520, 880, 0.07, 0.16];                    // a light tick (react, tie)
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* no audio device / blocked — the board works silently */ }
}

/* ── yarn: colored string tying two items together, conspiracy-wall
   style, so ideas visibly combine. Right-click → Tie yarn… → pick a
   color → click the other item. The string is shared state; it drapes
   over the paper (pointer-events:none, so it never blocks the wall). */
const YARN_HEX = { red: '#d64d4d', orange: '#e8923a', teal: '#10CFC9', purple: '#a97fe0', white: '#efe6d5' };
let redrawYarn = () => {}; // re-bound by each board render; drags re-aim strings live
window.addEventListener('resize', () => redrawYarn());

let tieMode = null; // { fromId, color, reload, fromA } — a color picked, string in hand
function setTie(t) {
  tieMode = t;
  document.body.classList.toggle('tying', !!t);
}

// Where on an item a click landed, as 0..1 fractions of its box — the
// yarn pins THERE. Captured when the item's menu opens (that click is the
// from-end) and when the tie-completing click lands (the to-end).
let menuAnchor = null;
function anchorFrac(ev, el) {
  const r = el.getBoundingClientRect();
  return {
    ax: Math.max(0, Math.min(1, (ev.clientX - r.left) / (r.width || 1))),
    ay: Math.max(0, Math.min(1, (ev.clientY - r.top) / (r.height || 1))),
  };
}

let yarnEl = null;
function hideYarnPad() { if (yarnEl) yarnEl.style.display = 'none'; }
function yarnPad(el, n, reload) {
  hideNotePop();
  if (!yarnEl) {
    yarnEl = h('div', { id: 'yarn-pad' });
    document.body.appendChild(yarnEl);
  }
  clear(yarnEl).append(...Object.keys(YARN_HEX).map(c =>
    h('button', {
      class: 'yarn-dot', 'aria-label': c + ' yarn', title: c + ' yarn',
      style: `background:${YARN_HEX[c]}`,
      onClick: () => {
        hideYarnPad();
        setTie({ fromId: n.id, color: c, reload, fromA: menuAnchor });
        toast('Yarn in hand — click another item to tie it. Esc puts it away');
      },
    })));
  yarnEl.style.display = 'flex';
  const r = el.getBoundingClientRect();
  const cx = Math.max(100, Math.min(window.innerWidth - 100, r.left + r.width / 2));
  const above = r.top - 54;
  yarnEl.style.left = cx + 'px';
  yarnEl.style.top = (above > 8 ? above : r.bottom + 12) + 'px';
}

function yarnLabel(item) {
  if (!item) return 'a missing item';
  return item.sticker_url
    ? `${item.poster_name || 'someone'}’s sticker`
    : `“${String(item.message).slice(0, 30)}”`;
}

/* every string touching this item — recolor or cut, row by row. Actions
   mutate bd.yarn and redraw in place, so the dialog never goes stale. */
function yarnDialog(n, bd) {
  const rows = bd.yarn.filter(y => y.from_id === n.id || y.to_id === n.id).map(y => {
    const other = bd.items[y.from_id === n.id ? y.to_id : y.from_id];
    const dots = h('span', { class: 'yarn-row-dots' },
      ...Object.keys(YARN_HEX).map(c => h('button', {
        class: 'yarn-dot sm' + (y.color === c ? ' on' : ''), title: c,
        style: `background:${YARN_HEX[c]}`,
        onClick: async ev => {
          try {
            await api.stickies({ op: 'yarn_color', id: y.id, color: c });
            y.color = c;
            [...dots.children].forEach(d => d.classList.remove('on'));
            ev.target.classList.add('on');
            redrawYarn();
          } catch (err) { toast(err.message, 'err'); }
        },
      })));
    const row = h('div', { class: 'yarn-row' },
      h('span', { class: 'yarn-row-label' }, `to ${yarnLabel(other)}`),
      dots,
      h('button', { class: 'btn xs danger', onClick: async () => {
        try {
          await api.stickies({ op: 'cut', id: y.id });
          bd.yarn.splice(bd.yarn.indexOf(y), 1);
          redrawYarn();
          row.remove();
          toast('Yarn cut');
        } catch (err) { toast(err.message, 'err'); }
      } }, 'Cut'));
    return row;
  });
  modal('Yarn on this item', h('div', { class: 'form' }, ...rows),
    [{ label: 'Done', kind: 'accent', onClick: c => c() }]);
}

/* The adjust pad — how rotate and scale happen now. Right-click an item,
   pick Rotate or Scale, and a small pad of real buttons appears by it:
   ‹ › spin 5° per press, − + resize 5% per press (stickers only), ✓
   confirms — and so does clicking anywhere off the pad, so the change
   people made is the change they keep. Escape is the one way out that
   reverts. No readouts on purpose: eyes stay on the item. */
let xfEl = null, xfState = null; // { el, n, undo: { rotation, scale } }
function hideXfPad(commit) {
  if (xfEl) xfEl.style.display = 'none';
  const s = xfState;
  xfState = null;
  if (!s) return;
  if (commit) {
    if ((s.n.rotation || 0) !== s.undo.rotation || (s.n.scale || 1) !== s.undo.scale) saveXf(s.n);
  } else {
    s.n.rotation = s.undo.rotation;
    s.n.scale = s.undo.scale;
    applyXf(s.el, s.n);
  }
}
function xfPad(mode, el, n) {
  hideXfPad(false);                 // one pad at a time; the old preview reverts
  hideNotePop();
  if (!xfEl) {
    xfEl = h('div', { id: 'xf-pad' });
    document.body.appendChild(xfEl);
  }
  xfState = { el, n, undo: { rotation: n.rotation || 0, scale: n.scale || 1 } };
  const nudge = fn => { fn(); applyXf(el, n); };
  const btn = (label, cls, fn) =>
    h('button', { class: 'xf-btn' + (cls ? ' ' + cls : ''), onClick: fn }, label);
  clear(xfEl).append(
    ...(mode === 'scale'
      ? [btn('−', '', () => nudge(() => { n.scale = Math.max(0.5, Math.round(((n.scale || 1) - 0.05) * 100) / 100); })),
         btn('+', '', () => nudge(() => { n.scale = Math.min(2, Math.round(((n.scale || 1) + 0.05) * 100) / 100); }))]
      : [btn('‹', '', () => nudge(() => { n.rotation = Math.max(-180, (n.rotation || 0) - 5); })),
         btn('›', '', () => nudge(() => { n.rotation = Math.min(180, (n.rotation || 0) + 5); }))]),
    btn('✓', 'ok', () => hideXfPad(true)));
  el.style.zIndex = ++zTop;         // the item being adjusted floats
  xfEl.style.display = 'flex';
  const r = el.getBoundingClientRect();
  const cx = Math.max(70, Math.min(window.innerWidth - 70, r.left + r.width / 2));
  const above = r.top - 56;
  xfEl.style.left = cx + 'px';
  xfEl.style.top = (above > 8 ? above : r.bottom + 12) + 'px';
}

/* one pair of document listeners governs every floating state:
   Escape puts yarn away first, then cancels an adjust preview; a
   pointerdown off the adjust pad confirms it exactly like the ✓
   (capture phase, so it lands before whatever the click was for),
   closes a forgotten color pad, and drops yarn on a miss. */
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (tieMode) { ev.preventDefault(); setTie(null); toast('Yarn put away'); return; }
  if (xfState) { ev.preventDefault(); hideXfPad(false); }
});
document.addEventListener('pointerdown', ev => {
  if (xfState && xfEl && !xfEl.contains(ev.target)) hideXfPad(true);
  if (yarnEl && yarnEl.style.display !== 'none' && !yarnEl.contains(ev.target)) hideYarnPad();
  if (tieMode && !(ev.target.closest && ev.target.closest('.note,.stk,.bkm'))) {
    setTie(null);
    toast('Yarn put away');
  }
}, true);

/* wire the full gesture set onto an item */
function makeInteractive(el, n, cork, { scalable, onMenu, reload, onTap }) {
  el.style.touchAction = 'none';
  const SLOP = 6; // px of travel from the press point before a press becomes a drag
  let hold = null, dragging = false, dragMoved = false, armed = false;
  let grabDX = 0, grabDY = 0, downX = 0, downY = 0, lastX = 0, lastY = 0;

  const place = (cx, cy) => {
    const cr = cork.getBoundingClientRect();
    n.pos_x = Math.max(0, Math.min(92, ((cx - grabDX - cr.left) / cr.width) * 100 - 4));
    n.pos_y = Math.max(0, Math.min(88, ((cy - grabDY - cr.top) / cr.height) * 100 - 4));
    applyXf(el, n);
    redrawYarn();                                      // strings follow the item live
  };
  const lift = () => {
    dragging = true;
    pop('up');
    hideNotePop();
    hideXfPad(false);                                  // safety only — the pointerdown that started this hold already committed any open pad
    el.classList.add('lifted');
    el.style.zIndex = ++zTop;
    // an eager hand may have flown to the target before the lift landed —
    // catch the item up to the pointer or the gesture strands it behind
    if (Math.hypot(lastX - downX, lastY - downY) > SLOP) { dragMoved = true; place(lastX, lastY); }
  };

  el.addEventListener('pointerdown', ev => {
    if (ev.button === 2) return;                       // right-click is the menu
    if (tieMode) {                                     // string in hand: this click ties, nothing else
      ev.preventDefault();
      const t = tieMode;
      if (t.fromId === n.id) { toast('That end is already tied — click a different item'); return; }
      setTie(null);
      const toA = anchorFrac(ev, el);                  // the string pins exactly where they clicked
      api.stickies({
        op: 'tie', from_id: t.fromId, to_id: n.id, color: t.color, board: boardNo,
        ...(t.fromA ? { from_ax: t.fromA.ax, from_ay: t.fromA.ay } : {}),
        to_ax: toA.ax, to_ay: toA.ay,
      })
        .then(() => { pop('tick'); toast('Tied'); t.reload(); })
        .catch(err => toast(err.message, 'err'));
      return;
    }
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    dragMoved = false; armed = true;
    downX = lastX = ev.clientX; downY = lastY = ev.clientY;
    const r = el.getBoundingClientRect();
    grabDX = ev.clientX - (r.left + r.width / 2);
    grabDY = ev.clientY - (r.top + r.height / 2);
    hold = setTimeout(lift, 300);                      // press-and-hold picks it up
  });
  el.addEventListener('pointermove', ev => {
    if (!el.hasPointerCapture || !el.hasPointerCapture(ev.pointerId)) return;
    lastX = ev.clientX; lastY = ev.clientY;
    if (!dragging) return;
    // motion begins only past a slop from the press point — the couple of
    // pixels a real hand jitters during a click must never nudge the item
    if (!dragMoved && Math.hypot(lastX - downX, lastY - downY) <= SLOP) return;
    dragMoved = true;
    place(lastX, lastY);
  });
  const settle = ev => {
    clearTimeout(hold);
    const wasArmed = armed;                            // a child that stopped propagation
    armed = false;                                     // (the ⋯ chip) never armed us
    if (!dragging) {
      // a clean tap — armed here, never left the slop — opens what wants
      // opening: bookmarks pass onTap, notes and stickers pass nothing
      if (onTap && wasArmed && ev.type === 'pointerup' &&
          Math.hypot(lastX - downX, lastY - downY) <= SLOP) onTap();
      return;
    }
    dragging = false;
    el.classList.remove('lifted');
    if (dragMoved) { pop('down'); saveXf(n); }         // release = confirm
  };
  el.addEventListener('pointerup', settle);
  el.addEventListener('pointercancel', settle);

  el.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    hideNotePop();
    menuAnchor = anchorFrac(ev, el);                   // if this menu ties yarn, it pins here
    ctxMenu(ev.clientX, ev.clientY, onMenu());
  });

  // Touch has no right-click (and iOS never fires contextmenu), so every
  // item wears a small ⋯ chip — CSS shows it only for coarse pointers.
  // Its pointerdown must not fall through, or tapping the menu would
  // start a hold-drag (or complete a yarn tie) underneath it.
  const chip = h('button', { class: 'itm-menu', 'aria-label': 'Item menu' }, '⋯');
  chip.addEventListener('pointerdown', ev => ev.stopPropagation());
  chip.addEventListener('click', ev => {
    ev.stopPropagation();
    hideNotePop();
    menuAnchor = anchorFrac(ev, el);                   // chip sits at the top-right corner; close enough
    ctxMenu(ev.clientX, ev.clientY, onMenu());
  });
  el.appendChild(chip);
}

/* ── a bare sticker on the cork ── */
function stickerItem(n, cork, reload, bd) {
  itemPos(n);
  const el = h('div', { class: 'stk' },
    h('img', { src: n.sticker_url, alt: 'sticker', loading: 'lazy', draggable: 'false' }));
  applyXf(el, n);
  makeInteractive(el, n, cork, {
    scalable: true,
    reload,
    onMenu: () => [
      ['Scale', () => xfPad('scale', el, n), false],
      ['Rotate', () => xfPad('rotate', el, n), false],
      ['Tie yarn…', () => yarnPad(el, n, reload), false],
      ...(bd.yarn.some(y => y.from_id === n.id || y.to_id === n.id)
        ? [['Yarn…', () => yarnDialog(n, bd), false]] : []),
      ['Take it down', () => confirmBox('Take this sticker down?',
        `${n.poster_name || 'Someone'}'s sticker comes off the board (it expires within 24h anyway).`, async () => {
          try { await api.stickies({ op: 'delete', id: n.id }); toast('Sticker down'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Take it down'), true],
    ],
  });
  el.addEventListener('mouseenter', () => {
    if (el.classList.contains('lifted')) return;
    const e = notePop();
    clear(e).append(h('div', { class: 'np-who' }, `${n.poster_name || '?'} · ${fmt.when(n.created_at)}`), h('div', { class: 'np-hint' }, 'hold to move · right-click to scale or rotate'));
    e.className = 'np-mini';
    placePop(e, el);
  });
  el.addEventListener('mouseleave', hideNotePop);
  return el;
}

/* ── a paper note, with corner reactions ── */
function noteItem(n, reacts, cork, reload, bd) {
  itemPos(n);
  const el = h('div', { class: 'note note-' + (n.color || 'yellow') },
    h('i', { class: 'note-pin' }),
    h('span', { class: 'note-msg' }, n.message),
    h('span', { class: 'note-by' }, '— ' + (n.poster_name || n.author || '?')),
    reacts.length ? (() => {
      const cluster = h('span', { class: 'rx-cluster', title: 'Click to manage reactions' },
        reacts.slice(0, 4).map(r => r.sticker_url
          ? h('img', { class: 'rx rx-img', src: r.sticker_url, alt: '', title: `${r.name} · ${fmt.when(r.created_at)}` })
          : h('span', { class: 'rx', title: `${r.name} · ${fmt.when(r.created_at)}` }, r.emoji)),
        reacts.length > 4 ? h('span', { class: 'rx rx-more' }, '+' + (reacts.length - 4)) : null);
      // the cluster is its own control — clicking it must not select/drag the note
      cluster.addEventListener('pointerdown', ev => ev.stopPropagation());
      cluster.addEventListener('click', ev => { ev.stopPropagation(); hideNotePop(); manageReactionsDialog(n, reacts, reload); });
      return cluster;
    })() : null);
  applyXf(el, n);
  makeInteractive(el, n, cork, {
    scalable: false,
    reload,
    onMenu: () => [
      ['React…', () => reactDialog(n, reload), false],
      ...(reacts.length ? [['Reactions…', () => manageReactionsDialog(n, reacts, reload), false]] : []),
      ['Rotate', () => xfPad('rotate', el, n), false],
      ['Tie yarn…', () => yarnPad(el, n, reload), false],
      ...(bd.yarn.some(y => y.from_id === n.id || y.to_id === n.id)
        ? [['Yarn…', () => yarnDialog(n, bd), false]] : []),
      ['Take it down', () => confirmBox('Take this note down?',
        `“${n.message}” comes off everyone's board. The change feed records who did it.`, async () => {
          try { await api.stickies({ op: 'delete', id: n.id }); toast('Note taken down'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Take it down'), true],
    ],
  });
  el.addEventListener('mouseenter', () => {
    if (el.classList.contains('lifted')) return;
    const e = notePop();
    clear(e).append(...[
      h('div', { class: 'np-msg' }, n.message),
      n.detail ? h('div', { class: 'np-detail' }, n.detail) : null,
      reacts.length ? h('div', { class: 'np-rx' }, reacts.map(r =>
        h('span', { class: 'np-rx-row' }, r.sticker_url
          ? h('img', { class: 'rx-img', src: r.sticker_url, alt: '' })
          : h('b', null, r.emoji), ` ${r.name}`))) : null,
      h('div', { class: 'np-foot' }, `${n.poster_name || n.author || '?'} · ${fmt.when(n.created_at)}`),
      h('div', { class: 'np-hint' }, 'hold to move · right-click to rotate, react, take down'),
    ].filter(Boolean));
    e.className = 'np-' + (n.color || 'yellow');
    placePop(e, el);
  });
  el.addEventListener('mouseleave', hideNotePop);
  return el;
}

/* ── a bookmark: a manila folder wearing the link's title. Opens on a
   clean tap, takes reactions and yarn exactly like a note. ── */
function bookmarkItem(n, reacts, cork, reload, bd) {
  itemPos(n);
  const openLink = () => window.open(n.link_url, '_blank', 'noopener');
  const el = h('div', { class: 'bkm' },
    h('span', { class: 'bkm-folder' }, h('span', { class: 'bkm-title' }, n.message)),
    h('span', { class: 'bkm-go' }, '↗'),
    reacts.length ? (() => {
      const cluster = h('span', { class: 'rx-cluster', title: 'Click to manage reactions' },
        reacts.slice(0, 4).map(r => r.sticker_url
          ? h('img', { class: 'rx rx-img', src: r.sticker_url, alt: '', title: `${r.name} · ${fmt.when(r.created_at)}` })
          : h('span', { class: 'rx', title: `${r.name} · ${fmt.when(r.created_at)}` }, r.emoji)),
        reacts.length > 4 ? h('span', { class: 'rx rx-more' }, '+' + (reacts.length - 4)) : null);
      cluster.addEventListener('pointerdown', ev => ev.stopPropagation());
      cluster.addEventListener('click', ev => { ev.stopPropagation(); hideNotePop(); manageReactionsDialog(n, reacts, reload); });
      return cluster;
    })() : null);
  applyXf(el, n);
  makeInteractive(el, n, cork, {
    scalable: false,
    reload,
    onTap: openLink,
    onMenu: () => [
      ['Open link', openLink, false],
      ['React…', () => reactDialog(n, reload), false],
      ...(reacts.length ? [['Reactions…', () => manageReactionsDialog(n, reacts, reload), false]] : []),
      ['Rotate', () => xfPad('rotate', el, n), false],
      ['Tie yarn…', () => yarnPad(el, n, reload), false],
      ...(bd.yarn.some(y => y.from_id === n.id || y.to_id === n.id)
        ? [['Yarn…', () => yarnDialog(n, bd), false]] : []),
      ['Take it down', () => confirmBox('Take this bookmark down?',
        `“${n.message}” comes off everyone's board. The change feed records who did it.`, async () => {
          try { await api.stickies({ op: 'delete', id: n.id }); toast('Bookmark down'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Take it down'), true],
    ],
  });
  el.addEventListener('mouseenter', () => {
    if (el.classList.contains('lifted')) return;
    let host = n.link_url;
    try { host = new URL(n.link_url).host; } catch { /* show the raw string */ }
    const e = notePop();
    clear(e).append(...[
      h('div', { class: 'np-msg' }, n.message),
      h('div', { class: 'np-detail' }, host),
      reacts.length ? h('div', { class: 'np-rx' }, reacts.map(r =>
        h('span', { class: 'np-rx-row' }, r.sticker_url
          ? h('img', { class: 'rx-img', src: r.sticker_url, alt: '' })
          : h('b', null, r.emoji), ` ${r.name}`))) : null,
      h('div', { class: 'np-foot' }, `${n.poster_name || n.author || '?'} · ${fmt.when(n.created_at)}`),
      h('div', { class: 'np-hint' }, 'click to open · hold to move · right-click to react or tie yarn'),
    ].filter(Boolean));
    e.className = 'np-yellow';
    placePop(e, el);
  });
  el.addEventListener('mouseleave', hideNotePop);
  return el;
}

/* ── dialogs ── */
function linkDialog(reload) {
  const title = textInput({ maxLength: 60, placeholder: "What the folder says — the link's name" });
  const url = textInput({ placeholder: 'https://…' });
  const name = textInput({ maxLength: 40, value: ME || recallName(), placeholder: 'First and last name — bookmarks are signed' });
  modal('Pin a bookmark',
    h('div', { class: 'form' },
      field('Title', title, 'Shows on the folder — up to 60 characters.'),
      field('Link', url, 'http(s) only. Clicking the folder opens it in a new tab.'),
      ...(ME ? [] : [field('Your name', name, 'Signs the bookmark — the board shows people, not keys.')])),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        const u = url.value.trim();
        if (!/^https?:\/\/\S+$/i.test(u)) { toast('That link needs to start with http(s)://', 'err'); return; }
        try {
          await api.stickies({ op: 'save', board: boardNo, message: title.value, link_url: u, poster_name: name.value });
          rememberName(name.value.trim());
          c(); toast('Bookmark pinned'); reload();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

function noteDialog(reload) {
  const msg = textInput({ maxLength: 60, placeholder: 'The short version (fits on the note)' });
  const det = h('textarea', { rows: 4, maxLength: 500, placeholder: 'The whole story — shows when someone hovers' });
  const emojiRow = h('div', { class: 'emoji-row' },
    ['🎉', '🔥', '😂', '💚', '👀', '🐛', '🏆', '☕'].map(e =>
      h('button', { class: 'emoji-btn', onClick: () => { msg.value += e; msg.focus(); } }, e)));
  const colors = ['yellow', 'pink', 'mint', 'blue', 'orange'];
  let picked = colors[0];
  const swatches = h('div', { class: 'swatch-row' }, colors.map(c => {
    const s = h('button', { class: 'swatch sw-' + c + (c === picked ? ' on' : ''), 'aria-label': c, onClick: () => {
      picked = c;
      [...swatches.children].forEach(x => x.classList.remove('on'));
      s.classList.add('on');
    } });
    return s;
  }));
  const name = textInput({ maxLength: 40, value: ME || recallName(), placeholder: 'First and last name — notes are signed' });
  modal('Pin a note',
    h('div', { class: 'form' },
      field('Note', msg, 'Up to 60 characters — this is what the board shows. Emoji welcome.'),
      emojiRow,
      field('Detail (optional)', det, 'Up to 500 — revealed on hover.'),
      field('Color', swatches),
      ...(ME ? [] : [field('Your name', name, 'Signs the note — the board shows people, not keys.')])),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        try {
          await api.stickies({ op: 'save', board: boardNo, message: msg.value, detail: det.value, color: picked, poster_name: name.value });
          rememberName(name.value.trim());
          c(); toast('Pinned'); reload();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* GIPHY picker used by both the sticker dialog and sticker reactions.
   onPick(url) fires when a cell is chosen. */
function giphyGrid(onPick) {
  const q = textInput({ placeholder: 'Search — “high five”, “deal closed”, “facepalm”…' });
  let type = 'stickers';
  const grid = h('div', { class: 'gif-grid' },
    h('p', { class: 'sub' }, 'Search to fill the drawer.'));
  const tabs = h('div', { class: 'gif-tabs' },
    ['stickers', 'gifs'].map(t => h('button', {
      class: 'btn xs' + (t === type ? ' accent' : ''),
      onClick: e => {
        type = t;
        [...tabs.children].forEach(x => x.classList.remove('accent'));
        e.target.classList.add('accent');
        if (q.value.trim()) run();
      },
    }, t === 'stickers' ? 'Stickers' : 'Memes')));
  async function run() {
    clear(grid).appendChild(h('p', { class: 'sub' }, 'Searching…'));
    try {
      const d = await api.giphySearch(q.value.trim(), type);
      clear(grid);
      if (!(d.results || []).length) { grid.appendChild(h('p', { class: 'sub' }, 'Nothing for that — try other words.')); return; }
      for (const g of d.results) {
        const cell = h('button', { class: 'gif-cell', title: g.title, onClick: () => {
          [...grid.children].forEach(x => x.classList && x.classList.remove('on'));
          cell.classList.add('on');
          onPick(g.url);
        } }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }));
        grid.appendChild(cell);
      }
    } catch (err) { clear(grid).appendChild(h('p', { class: 'sub' }, err.message)); }
  }
  q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  return h('div', { class: 'form' },
    h('div', { class: 'gif-search' }, q, h('button', { class: 'btn', onClick: run }, 'Search'), tabs),
    grid);
}

function stickerDialog(reload) {
  const name = textInput({ maxLength: 40, value: ME || recallName(), placeholder: 'Your name — stickers are signed' });
  let pickedUrl = '';
  modal('Pin a sticker',
    h('div', { class: 'form' },
      ...(ME ? [] : [field('Your name', name, 'Shows when someone hovers your sticker. Stickers expire after 24 hours.')]),
      giphyGrid(url => { pickedUrl = url; })),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        if (!pickedUrl) { toast('Pick a sticker first', 'err'); return; }
        try {
          await api.stickies({ op: 'save', board: boardNo, sticker_url: pickedUrl, poster_name: name.value });
          rememberName(name.value.trim());
          c(); toast('Pinned — it rides for 24 hours'); reload();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* ── manage reactions: stacked in order, each ✕-able. A group of the same
   emoji asks HOW MANY to remove, adjusted with − / + around the number.
   Removal takes the newest first — the mistaken click is the latest. ── */
function manageReactionsDialog(n, reacts, reload) {
  // group by emoji-or-sticker, in order of first appearance
  const groups = [];
  const byKey = {};
  for (const r of reacts) {
    const k = r.sticker_url || r.emoji;
    if (!byKey[k]) { byKey[k] = { emoji: r.emoji, sticker_url: r.sticker_url, names: [] }; groups.push(byKey[k]); }
    byKey[k].names.push(r.name);
  }
  let close;
  const remove = async (g, count) => {
    try {
      await api.stickies({ op: 'unreact', sticky_id: n.id, emoji: g.emoji, sticker_url: g.sticker_url, count });
      close(); toast(count > 1 ? `${count} reactions removed` : 'Reaction removed'); reload();
    } catch (err) { toast(err.message, 'err'); }
  };
  const rows = groups.map(g => {
    const face = g.sticker_url
      ? h('img', { class: 'rx-img rxm-face', src: g.sticker_url, alt: '' })
      : h('span', { class: 'rxm-face' }, g.emoji);
    const names = h('span', { class: 'rxm-names' },
      g.names.length > 1 ? `×${g.names.length} — ${g.names.join(', ')}` : g.names[0]);
    const row = h('div', { class: 'rxm-row' }, face, names);
    if (g.names.length === 1) {
      row.appendChild(h('button', { class: 'btn xs danger', 'aria-label': 'Remove', onClick: () => remove(g, 1) }, '✕'));
    } else {
      // ✕ swaps the row's tail for the − n + stepper
      const tail = h('span', { class: 'rxm-tail' },
        h('button', { class: 'btn xs danger', 'aria-label': 'Remove some', onClick: () => {
          let k = 1;
          const num = h('b', { class: 'rxm-n' }, '1');
          clear(tail).append(
            h('button', { class: 'btn xs', 'aria-label': 'Fewer', onClick: () => { k = Math.max(1, k - 1); num.textContent = String(k); } }, '−'),
            num,
            h('button', { class: 'btn xs', 'aria-label': 'More', onClick: () => { k = Math.min(g.names.length, k + 1); num.textContent = String(k); } }, '+'),
            h('button', { class: 'btn xs danger', onClick: () => remove(g, k) }, 'Remove'));
        } }, '✕'));
      row.appendChild(tail);
    }
    return row;
  });
  close = modal('Reactions on the note',
    h('div', { class: 'form' },
      h('p', { class: 'explain' }, `“${n.message}” — removals take the newest of a kind first.`),
      h('div', { class: 'rxm-list' }, rows)),
    [{ label: 'Done', onClick: c => c() }]);
}

function reactDialog(n, reload) {
  const name = textInput({ maxLength: 40, value: ME || recallName(), placeholder: 'Your name — reactions are signed' });
  let chosen = { emoji: '', sticker_url: '' };
  const status = h('span', { class: 'sub' }, 'Pick one below.');
  const emojiRow = h('div', { class: 'emoji-row rx-pick' },
    ['👍', '🎉', '🔥', '😂', '💚', '👏', '💯', '😮'].map(e =>
      h('button', { class: 'emoji-btn', onClick: ev => {
        chosen = { emoji: e, sticker_url: '' };
        [...emojiRow.children].forEach(x => x.classList.remove('on'));
        ev.target.classList.add('on');
        status.textContent = `Reacting with ${e}`;
      } }, e)));
  modal('React to the note',
    h('div', { class: 'form' },
      h('p', { class: 'explain' }, `“${n.message}”`),
      ...(ME ? [] : [field('Your name', name)]),
      field('Emoji', emojiRow),
      field('…or a small sticker', giphyGrid(url => {
        chosen = { emoji: '', sticker_url: url };
        [...emojiRow.children].forEach(x => x.classList.remove('on'));
        status.textContent = 'Reacting with a sticker';
      })),
      status),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Stick it', kind: 'accent', onClick: async c => {
        try {
          await api.stickies({ op: 'react', sticky_id: n.id, name: name.value, emoji: chosen.emoji, sticker_url: chosen.sticker_url });
          rememberName(name.value.trim());
          pop('tick');
          c(); toast('Reaction stuck'); reload();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}
/* ── calendar widget rebuild (public feed — every key sees it) ── */
async function loadCalendar(card, scopes, acts) {
  let d;
  try { d = await api.publicEvents(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadCalendar(card, scopes, acts))); return; }
  clear(card);

  const events = d.events || [];
  const cats = d.categories || {};
  const byDate = {};
  for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);

  let view = new Date(); view.setDate(1);
  const head = h('div', { class: 'mc-head' });
  const gridEl = h('div', { class: 'mc-grid' });
  const listEl = h('div', { class: 'mc-list' });

  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    clear(head).append(
      h('button', { class: 'btn xs', 'aria-label': 'Previous month', onClick: () => { view = new Date(y, m - 1, 1); draw(); } }, '‹'),
      h('span', { class: 'mc-month' }, `${MONTHS_LONG[m]} ${y}`),
      h('button', { class: 'btn xs', 'aria-label': 'Next month', onClick: () => { view = new Date(y, m + 1, 1); draw(); } }, '›'));
    clear(gridEl);
    for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) gridEl.appendChild(h('span', { class: 'mc-wd' }, wd));
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < first; i++) gridEl.appendChild(h('span'));
    for (let day = 1; day <= days; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const evs = byDate[iso] || [];
      const cell = h('span', {
        class: 'mc-day' + (evs.length ? ' has' : '')
          + (+new Date(y, m, day) === +today ? ' today' : '') + (isPast(iso) ? ' past' : ''),
        title: evs.map(e => e.title).join(' · ') || null,
      }, String(day),
        evs.length ? h('span', { class: 'mc-dots' }, evs.slice(0, 3).map(e =>
          h('i', { style: { background: (cats[e.category] || {}).color || 'var(--muted)' } }))) : null);
      if (evs.length && scopes.includes('calendar')) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => { location.hash = '#calendar'; });
      }
      gridEl.appendChild(cell);
    }
  };
  draw();

  const upcoming = events.filter(e => !isPast(e.date)).slice(0, 3);
  if (upcoming.length) {
    listEl.append(...upcoming.map(e => h('a', {
      class: 'mc-up', href: scopes.includes('calendar') ? '#calendar' : null,
      style: { '--evc': (cats[e.category] || {}).color || 'var(--muted)' },
    },
      h('span', { class: 'mc-up-date' }, `${e.month} ${e.day}`),
      h('span', { class: 'mc-up-title' }, e.title))));
  } else {
    listEl.appendChild(h('p', { class: 'sub' }, 'Nothing upcoming on the calendar.'));
  }

  card.append(sectionTitle('Calendar', h('span', { class: 'sec-sub' }, 'as Mission Control shows it')), head, gridEl, listEl);
  if (acts && acts.length) card.appendChild(h('div', { class: 'qa-row qa-under' }, acts));
}

/* ── change feed ── */
/* ── the Enablement News Feed: curated L&D/enablement blogs, filtered
   server-side to the two themes the team runs on — sales enablement and
   AI. Public feed, DB-cached; a broken feed day degrades to a quiet
   card, never an error wall. ── */
const INSPO_AGE = iso => {
  const d = Math.round((Date.now() - new Date(iso || 0).getTime()) / 86400000);
  return !isFinite(d) || d < 0 ? '' : d === 0 ? 'today' : d === 1 ? '1d' : d < 60 ? `${d}d` : '';
};
async function loadInspoCard(card) {
  let d;
  try { d = await api.inspiration(); }
  catch { card.remove(); return; } // extra content for free — absent silently
  const items = d.items || [];
  if (!items.length) { card.remove(); return; }
  clear(card);
  card.classList.add('inspo-card');

  const tagsFor = it => h('span', { class: 'inspo-tags' },
    it.themes.includes('ai') ? h('span', { class: 'inspo-tag t-ai' }, 'AI') : null,
    it.themes.includes('enablement') ? h('span', { class: 'inspo-tag t-se' }, 'SE') : null);
  const metaFor = it => [it.source, INSPO_AGE(it.published)].filter(Boolean).join(' · ');

  // the one line, cross-fading through the stream
  const line = h('a', { class: 'inspo-line', target: '_blank', rel: 'noopener' });
  const renderLine = it => {
    line.href = it.url;
    clear(line).append(tagsFor(it),
      h('span', { class: 'inspo-title' }, it.title),
      h('span', { class: 'inspo-meta' }, metaFor(it)));
  };
  let idx = 0;
  renderLine(items[0]);

  // the drop-down: the fuller stream, for when someone wants to browse
  const drawer = h('div', { class: 'inspo-drawer' },
    h('div', { class: 'inspo' }, items.slice(0, 10).map(it =>
      h('a', { class: 'inspo-row', href: it.url, target: '_blank', rel: 'noopener' },
        tagsFor(it),
        h('span', { class: 'inspo-title' }, it.title),
        h('span', { class: 'inspo-meta' }, metaFor(it))))));
  const caret = h('button', { class: 'inspo-caret', 'aria-label': 'More enablement news', onClick: () => {
    card.classList.toggle('open');
    caret.textContent = card.classList.contains('open') ? '▴' : '▾';
  } }, '▾');

  card.append(h('div', { class: 'inspo-bar' },
    h('span', { class: 'inspo-label' }, 'News'), line, caret), drawer);

  // rotate gently; a hover means someone is reading, an open drawer means
  // they're browsing — both hold the line still
  let hover = false;
  card.addEventListener('mouseenter', () => { hover = true; });
  card.addEventListener('mouseleave', () => { hover = false; });
  const timer = setInterval(() => {
    if (!card.isConnected) { clearInterval(timer); return; }
    if (hover || card.classList.contains('open')) return;
    line.classList.add('fading');
    setTimeout(() => {
      if (!card.isConnected) return;
      idx = (idx + 1) % items.length;
      renderLine(items[idx]);
      line.classList.remove('fading');
    }, 500);
  }, 8000);
}

/* ── projects at a glance: the compact Home cut — no calendar, no charts,
   just the promises. Server-ordered: overdue first, then soonest due. ── */
/* the Leadership Brief teaser — this week's counts and a door in */
async function loadBriefCard(card) {
  let r;
  try { r = await api.brief({ op: 'digest', window: 'week' }); }
  catch { card.remove(); return; } // pre-Setup or no access: no teaser
  const c = r.digest.counts;
  clear(card);
  card.appendChild(sectionTitle('Leadership Brief',
    h('a', { class: 'btn sm', href: '#projects/brief' }, 'Open The Brief')));
  card.appendChild(h('p', { class: 'brief-home-counts' },
    `This week: ${c.moved} status move${c.moved === 1 ? '' : 's'} · ` +
    `${r.digest.milestonesHit.length} milestone${r.digest.milestonesHit.length === 1 ? '' : 's'} hit · ` +
    `${c.overdue} overdue · ${c.lulls} project${c.lulls === 1 ? '' : 's'} without activity`));
  card.appendChild(h('p', { class: 'sub' },
    'Week, month and quarter — compiled from the board, copy-ready for the update you send upward.'));
}

async function loadProjectsCard(card, scopes) {
  let d;
  try { d = await api.projects({ op: 'list' }); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadProjectsCard(card, scopes))); return; }
  clear(card);
  const teamById = {}, statusById = {};
  for (const t of d.teams) teamById[t.id] = t;
  for (const s of d.statuses) statusById[s.id] = s;
  card.appendChild(sectionTitle('Projects',
    h('a', { class: 'btn xs', href: '#projects' }, 'Open the board'),
    ...(scopes.includes('projects') ? [h('a', { class: 'btn xs accent', href: '#projects/new' }, '+ New')] : [])));
  const rows = (d.projects || []).slice(0, 6);
  if (!rows.length) {
    card.appendChild(emptyState('No projects posted yet.',
      scopes.includes('projects') ? 'Post the first one from the board.' : null));
    return;
  }
  card.appendChild(h('div', { class: 'prj-glance' }, rows.map(p => {
    const st = statusById[p.status_id];
    return h('a', { class: 'prj-glance-row', href: '#projects' },
      h('span', { class: 'prj-glance-title' }, p.title),
      h('span', { class: 'prj-glance-team' }, (teamById[p.team_id] || {}).name || ''),
      st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
      p.overdue
        ? h('span', { class: 'overdue-badge' }, 'OVERDUE')
        : h('span', { class: 'prj-glance-team' }, `due ${fmt.day(p.phase_due)}`));
  })));
}

async function loadLog(card) {
  let d;
  try { d = await api.listLog(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadLog(card))); return; }
  clear(card);
  card.appendChild(sectionTitle('Latest changes'));
  const rows = d.log || [];
  if (!rows.length) {
    card.appendChild(emptyState('No changes recorded yet.',
      d.pending ? 'Run Setup under Access & Setup to switch the change feed on.' : 'Edits made from here will show up in this feed.'));
    return;
  }
  // Three rows visible, the rest a scroll away inside the frame. Times are
  // the VIEWER's local clock, AM/PM — fmt.when formats the raw timestamp.
  card.appendChild(h('div', { class: 'feed feed-scroll' }, rows.map(r =>
    h('div', { class: 'feed-row' },
      h('span', { class: 'feed-at' }, fmt.when(r.created_at)),
      h('div', { class: 'feed-main' },
        h('span', { class: 'feed-summary' }, r.summary),
        h('span', { class: 'feed-actor' }, r.actor, ' · ', r.action))))));
}

/* ── the Stellar-Seller widget ── */
async function loadStellar(card, scopes) {
  const canStats = scopes.includes('analytics');
  const canContent = scopes.includes('content');
  const canBanners = scopes.includes('banners');

  let a = null, q = null;
  try {
    [a, q] = await Promise.all([
      canStats ? api.analytics() : Promise.resolve(null),
      (canStats || canContent) ? api.questionStats() : Promise.resolve(null),
    ]);
  } catch (err) { clear(card).appendChild(errorState(err, () => loadStellar(card, scopes))); return; }
  clear(card);

  const links = [];
  if (canBanners) links.push(h('a', { class: 'btn sm', href: '#banners/stellar/new' }, '+ Action banner'));
  if (canContent) links.push(h('a', { class: 'btn sm', href: '#questions/questions/new' }, '+ Question'));
  if (canStats) links.push(h('a', { class: 'btn sm accent', href: '#dashboard' }, 'Full stats'));
  card.appendChild(sectionTitle('Stellar-Seller & the Side-Qlik', ...links));

  const excluded = (a && a.excluded) || [];
  const statsByTrig = {};
  for (const p of (a && a.top) || []) statsByTrig[p.trigram] = p;

  // ── recent scores as a ticker banner ──
  if (canStats) {
    const recent = (a.recent || []);
    if (recent.length) {
      const items = recent.map(r => {
        const it = h('span', { class: 'tk-item', dataset: { trigram: r.trigram } },
          h('b', { class: 'mono' }, r.trigram), ` +${fmt.int(r.points)} `,
          h('i', null, r.territory));
        wirePop(it, statsByTrig[r.trigram], excluded);
        return it;
      });
      // duplicated run so the loop is seamless
      const items2 = recent.map(r => h('span', { class: 'tk-item', 'aria-hidden': 'true' },
        h('b', { class: 'mono' }, r.trigram), ` +${fmt.int(r.points)} `, h('i', null, r.territory)));
      card.appendChild(h('div', { class: 'tk-wrap' },
        h('span', { class: 'tk-label' }, 'RECENT'),
        h('div', { class: 'tk-window' }, h('div', { class: 'tk-run' }, items, items2))));
    }
  }

  const cols = h('div', { class: 'ss-cols' });
  card.appendChild(cols);

  // ── leaders ──
  // Staff never rank, in CAPCOM either — a leaderboard is a leaderboard.
  // They remain visible (badged) in the Players table, where they're managed.
  if (canStats) {
    const top = ((a && a.top) || []).filter(p => !excluded.includes(p.trigram) && Number(p.total_score) > 0).slice(0, 6);
    const col = h('div', { class: 'ss-col' }, h('h3', { class: 'ss-h' }, 'Leaders'));
    if (!top.length) col.appendChild(emptyState('No players yet.'));
    else col.appendChild(h('div', { class: 'ld-list' }, top.map((p, i) => {
      const row = h('div', { class: 'ld-row', dataset: { trigram: p.trigram } },
        h('span', { class: 'ld-rank' }, String(i + 1)),
        h('span', { class: 'ld-trig mono' }, p.trigram,
          excluded.includes(p.trigram) ? chip('staff', 'muted') : null),
        h('span', { class: 'ld-terr' }, p.territory),
        h('span', { class: 'ld-pts num' }, fmt.int(p.total_score)),
        h('span', { class: 'ld-acc num' }, fmt.pct(p.correct, p.attempted)));
      wirePop(row, p, excluded);
      return row;
    })));
    cols.appendChild(col);
  }

  // ── most-missed questions ──
  if (q) {
    const min = q.minAttempts || 5;
    const scored = (q.rows || []).map(r => ({
      ...r, missPct: r.attempted > 0 ? Math.round(100 * (r.attempted - r.correct) / r.attempted) : 0,
    }));
    const solid = scored.filter(r => r.attempted >= min && r.missPct > 0)
      .sort((x, y) => y.missPct - x.missPct || y.attempted - x.attempted).slice(0, 6);
    const col = h('div', { class: 'ss-col' }, h('h3', { class: 'ss-h' }, 'Most missed'));
    if (!solid.length) {
      col.appendChild(emptyState('Not enough answer data yet.',
        `Fills in once questions have ${min}+ answers — counting started 28 Aug.`));
    } else {
      col.appendChild(h('div', { class: 'miss-list' }, solid.map(r =>
        h('div', { class: 'miss-row', title: r.label },
          h('div', { class: 'miss-main' },
            h('span', { class: 'miss-label' }, r.label),
            h('span', { class: 'miss-meta' }, `${r.game} · ${r.attempted - r.correct} of ${r.attempted} missed`)),
          h('div', { class: 'miss-track' }, h('div', { class: 'miss-fill', style: { width: r.missPct + '%' } })),
          h('span', { class: 'miss-pct' }, r.missPct + '%')))));
    }
    cols.appendChild(col);
  }
}

