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

export function render(params, rerender, who) {
  const scopes = (who && who.scopes) || [];
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

  // Two columns: calendar (with its actions) left; clock over changes right.
  const grid = h('div', { class: 'grid2 home-cols' });
  root.appendChild(grid);

  const leftCol = h('div', { class: 'home-col' });
  const rightCol = h('div', { class: 'home-col' });
  grid.append(leftCol, rightCol);

  // Left column: calendar (with actions), then the change feed under it.
  const calCard = h('div', { class: 'card' }, spinner());
  leftCol.appendChild(calCard);
  loadCalendar(calCard, scopes, acts);
  const logCard = h('div', { class: 'card' }, spinner());
  leftCol.appendChild(logCard);
  loadLog(logCard);

  // Right column: clock, then the corkboard with room to breathe.
  rightCol.appendChild(clockCard());
  const board = h('div', { class: 'card board-card' }, spinner());
  rightCol.appendChild(board);
  loadBoard(board, rerender);

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
  const card = h('div', { class: 'card' },
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
  card.appendChild(sectionTitle('The Corkboard',
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
    h('button', { class: 'btn sm', onClick: () => stickerDialog(reload) }, '+ Sticker'),
    h('button', { class: 'btn sm accent', onClick: () => noteDialog(reload) }, '+ Note')));

  const notes = d.notes || [];
  const reactsBy = {};
  for (const r of d.reactions || []) (reactsBy[r.sticky_id] = reactsBy[r.sticky_id] || []).push(r);

  const cork = h('div', { class: 'cork cork-free' });
  cork.addEventListener('pointerdown', ev => { if (ev.target === cork) deselect(); });
  card.appendChild(cork);
  if (!notes.length) {
    cork.appendChild(h('p', { class: 'cork-empty' }, `Board ${boardNo} is bare. Pin something.`));
    return;
  }

  // Layering: the latest pin sits on top. Rows arrive newest-first, so the
  // base z-index descends through the list; interaction bumps ride above.
  notes.forEach((n, i) => {
    const el = n.sticker_url
      ? stickerItem(n, cork, reload)
      : noteItem(n, reactsBy[n.id] || [], cork, reload);
    el.style.zIndex = String(notes.length - i);
    cork.appendChild(el);
  });
}

/* ── direct manipulation: the touch-wall engine ──
   The board is free space. Every item carries pos_x/pos_y (percent of the
   cork, shared state like rotation and scale), and the interactions read
   like a touch screen:

   press-and-hold (~300ms)  lift the item, drag anywhere, release to place
   single click             select — bounding box, rotate handle, ✕
   drag the ◰ corner        resize (stickers only, 0.5x–2x, from center)
   drag the ⟳ lollipop      rotate around the center
   right-click              menu: react (notes) / take down
   click the cork           deselect

   One transform write per gesture, on release — the motion itself is
   local and 60fps. */

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

/* Selection carries the item's data so the keyboard can steer it:
   A / D rotate 5° per press, − / + scale 5% per press (stickers only),
   Escape lets go. One debounced save per burst of keys. */
let selected = null; // { el, n, scalable }
let keySaveTimer = null;
function deselect() {
  if (selected) { selected.el.classList.remove('sel'); selected = null; }
}
let keysInstalled = false;
function installKeys() {
  if (keysInstalled) return;
  keysInstalled = true;
  document.addEventListener('keydown', ev => {
    if (!selected) return;
    // never steal keys from a form field
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const { el, n, scalable } = selected;
    let handled = true;
    const k = ev.key;
    if (k === 'a' || k === 'A') n.rotation = Math.max(-180, (n.rotation || 0) - 5);
    else if (k === 'd' || k === 'D') n.rotation = Math.min(180, (n.rotation || 0) + 5);
    else if ((k === '+' || k === '=') && scalable) n.scale = Math.min(2, Math.round(((n.scale || 1) + 0.05) * 100) / 100);
    else if ((k === '-' || k === '_') && scalable) n.scale = Math.max(0.5, Math.round(((n.scale || 1) - 0.05) * 100) / 100);
    else if (k === 'Escape') { deselect(); return; }
    else handled = false;
    if (!handled) return;
    ev.preventDefault();
    applyXf(el, n);
    clearTimeout(keySaveTimer);
    keySaveTimer = setTimeout(() => saveXf(n), 600);
  });
}

/* wire the full gesture set onto an item */
function makeInteractive(el, n, cork, { scalable, onMenu, reload }) {
  el.style.touchAction = 'none';
  let hold = null, dragging = false, moved = false;
  let grabDX = 0, grabDY = 0;

  const lift = () => {
    dragging = true;
    hideNotePop();
    el.classList.add('lifted');
    el.style.zIndex = ++zTop;
  };

  el.addEventListener('pointerdown', ev => {
    if (ev.button === 2) return;                       // right-click is the menu
    if (ev.target.closest && ev.target.closest('.handle')) return; // handles own their gestures
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    moved = false;
    const r = el.getBoundingClientRect();
    grabDX = ev.clientX - (r.left + r.width / 2);
    grabDY = ev.clientY - (r.top + r.height / 2);
    hold = setTimeout(lift, 300);                      // press-and-hold picks it up
  });
  el.addEventListener('pointermove', ev => {
    if (!el.hasPointerCapture || !el.hasPointerCapture(ev.pointerId)) return;
    if (!dragging) {
      if (Math.abs(ev.movementX) + Math.abs(ev.movementY) > 1) moved = true;
      return;
    }
    const cr = cork.getBoundingClientRect();
    n.pos_x = Math.max(0, Math.min(92, ((ev.clientX - grabDX - cr.left) / cr.width) * 100 - 4));
    n.pos_y = Math.max(0, Math.min(88, ((ev.clientY - grabDY - cr.top) / cr.height) * 100 - 4));
    applyXf(el, n);
  });
  const settle = ev => {
    clearTimeout(hold);
    if (dragging) {
      dragging = false;
      el.classList.remove('lifted');
      saveXf(n);                                       // release = confirm
    } else if (!moved && ev.type === 'pointerup') {
      // plain click: select / toggle — the keyboard steers the selection
      if (selected && selected.el === el) deselect();
      else {
        deselect();
        selected = { el, n, scalable };
        el.classList.add('sel');
        el.style.zIndex = ++zTop;
        installKeys();
      }
    }
  };
  el.addEventListener('pointerup', settle);
  el.addEventListener('pointercancel', settle);

  el.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    hideNotePop();
    ctxMenu(ev.clientX, ev.clientY, onMenu());
  });
}

/* ── a bare sticker on the cork ── */
function stickerItem(n, cork, reload) {
  itemPos(n);
  const el = h('div', { class: 'stk' },
    h('img', { src: n.sticker_url, alt: 'sticker', loading: 'lazy', draggable: 'false' }));
  applyXf(el, n);
  makeInteractive(el, n, cork, {
    scalable: true,
    reload,
    onMenu: () => [[
      'Take it down', () => confirmBox('Take this sticker down?',
        `${n.poster_name || 'Someone'}'s sticker comes off the board (it expires within 24h anyway).`, async () => {
          try { await api.stickies({ op: 'delete', id: n.id }); toast('Sticker down'); reload(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Take it down'), true,
    ]],
  });
  el.addEventListener('mouseenter', () => {
    if (el.classList.contains('lifted')) return;
    const e = notePop();
    clear(e).append(h('div', { class: 'np-who' }, `${n.poster_name || '?'} · ${fmt.when(n.created_at)}`), h('div', { class: 'np-hint' }, 'hold to move · click then A/D rotate, −/+ size'));
    e.className = 'np-mini';
    placePop(e, el);
  });
  el.addEventListener('mouseleave', hideNotePop);
  return el;
}

/* ── a paper note, with corner reactions ── */
function noteItem(n, reacts, cork, reload) {
  itemPos(n);
  const el = h('div', { class: 'note note-' + (n.color || 'yellow') },
    h('i', { class: 'note-pin' }),
    h('span', { class: 'note-msg' }, n.message),
    h('span', { class: 'note-by' }, '— ' + (n.author || '?')),
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
      h('div', { class: 'np-foot' }, `${n.author || '?'} · ${fmt.when(n.created_at)}`),
      h('div', { class: 'np-hint' }, 'hold to move · click then A/D rotate, −/+ size · right-click menu'),
    ].filter(Boolean));
    e.className = 'np-' + (n.color || 'yellow');
    placePop(e, el);
  });
  el.addEventListener('mouseleave', hideNotePop);
  return el;
}
/* ── dialogs ── */
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
  modal('Pin a note',
    h('div', { class: 'form' },
      field('Note', msg, 'Up to 60 characters — this is what the board shows. Emoji welcome.'),
      emojiRow,
      field('Detail (optional)', det, 'Up to 500 — revealed on hover.'),
      field('Color', swatches)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        try { await api.stickies({ op: 'save', board: boardNo, message: msg.value, detail: det.value, color: picked }); c(); toast('Pinned'); reload(); }
        catch (err) { toast(err.message, 'err'); }
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
  const name = textInput({ maxLength: 40, value: recallName(), placeholder: 'Your name — stickers are signed' });
  let pickedUrl = '';
  modal('Pin a sticker',
    h('div', { class: 'form' },
      field('Your name', name, 'Shows when someone hovers your sticker. Stickers expire after 24 hours.'),
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
  const name = textInput({ maxLength: 40, value: recallName(), placeholder: 'Your name — reactions are signed' });
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
      field('Your name', name),
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

