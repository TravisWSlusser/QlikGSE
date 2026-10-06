/* board.js — the Community Board (the corkboard), lifted out of home.js.
 *
 * It lives here because GSE Social mirrors it. Travis asked for the board
 * to appear on both pages, and "appear on both pages" has exactly two
 * implementations: one module mounted twice, or two copies that drift.
 * Module state is deliberately shared — change board 3 on Home and GSE
 * Central is on board 3 too, because it is the same board.
 *
 * The host supplies who is looking (boardViewer) because the board signs
 * everything with a real name and matches posters to faces; it has no
 * other dependency on the page it sits in.
 *
 * Everything below moved verbatim from home.js. The behaviour notes in it
 * were written when it was built and still apply.
 */
import { h, clear, fmt } from './util.js';
import { api } from './api.js';
import { toast, modal, confirmBox, field, textInput, spinner, errorState, sectionTitle, emptyState, chip } from './ui.js';
import { giphyGrid } from './giphy.js';
import { avatar, avatarName } from './avatar.js';

/* Who is signing, and the registry that turns a typed name into a face.
   home.js and projectsInsights.js both call this before mounting. */
let ME = null;
let PEOPLE = null;
export function boardViewer({ me, people }) {
  ME = me || null;
  PEOPLE = people || null;
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

/* Who pinned this. A sticky is a CHIP context, so the face stands alone
   and the name lives on hover - the paper is small and a name across it
   competes with the thing the note actually says.
   A poster we cannot match to a staff member (an SME on a scoped key,
   or someone who typed their name differently) keeps the written
   signature. Never a blank face for a person we simply do not know. */
let BOARD_PEOPLE = {};
/* The same person, in PROSE - face and name together, for the hover
   panel where there is room and the sentence needs a subject. */
function poster(n) {
  const raw = (n.poster_name || n.author || '').trim();
  const m = raw && BOARD_PEOPLE[raw.toLowerCase()];
  return m ? avatarName(m) : h('b', null, raw || '?');
}

function signature(n) {
  const raw = (n.poster_name || n.author || '').trim();
  const m = raw && BOARD_PEOPLE[raw.toLowerCase()];
  if (!m) return h('span', { class: 'note-by' }, '\u2014 ' + (raw || '?'));
  return h('span', { class: 'note-by note-by-av' }, avatar(m, { size: 'xs' }));
}
function placePop(e, anchor) {
  e.style.display = 'block';
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 100, bottom: 100, top: 80 };
  const w = e.offsetWidth || 300;
  let x = Math.min(r.left, window.innerWidth - w - 16);
  let y = r.bottom + 8;
  if (y + (e.offsetHeight || 160) > window.innerHeight - 8) y = Math.max(8, r.top - (e.offsetHeight || 160) - 8);
  e.style.left = x + 'px'; e.style.top = y + 'px';
}

export async function loadBoard(card, rerender) {
  // registry first, so the very first paint can already sign with faces
  try { const ppl = await PEOPLE; if (ppl) BOARD_PEOPLE = ppl.memberByName || {}; } catch {}
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
    clear(e).append(h('div', { class: 'np-who' }, poster(n), h('span', { class: 'sub' }, fmt.when(n.created_at))), h('div', { class: 'np-hint' }, 'hold to move · right-click to scale or rotate'));
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
    signature(n),
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
      h('div', { class: 'np-foot' }, poster(n), h('span', { class: 'sub' }, fmt.when(n.created_at))),
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
      h('div', { class: 'np-foot' }, poster(n), h('span', { class: 'sub' }, fmt.when(n.created_at))),
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
