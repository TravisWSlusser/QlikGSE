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

/* ── the sticker drawer: search GIPHY, pick, pin ── */
function stickerDialog(rerender) {
  const q = textInput({ placeholder: 'Search stickers — “high five”, “deal closed”, “facepalm”…' });
  const cap = textInput({ maxLength: 60, placeholder: 'Optional caption (shows under the sticker)' });
  let type = 'stickers';
  let pickedUrl = '';
  const grid = h('div', { class: 'gif-grid' },
    h('p', { class: 'sub' }, 'Search to fill the drawer. Stickers have transparent backs; memes are full GIFs.'));
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
          pickedUrl = g.url;
          [...grid.children].forEach(x => x.classList && x.classList.remove('on'));
          cell.classList.add('on');
        } }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }));
        grid.appendChild(cell);
      }
    } catch (err) { clear(grid).appendChild(h('p', { class: 'sub' }, err.message)); }
  }
  q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  modal('Pin a sticker',
    h('div', { class: 'form' },
      h('div', { class: 'gif-search' }, q, h('button', { class: 'btn', onClick: run }, 'Search'), tabs),
      grid,
      field('Caption (optional)', cap)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        if (!pickedUrl) { toast('Pick a sticker first', 'err'); return; }
        try { await api.stickies({ op: 'save', message: cap.value, sticker_url: pickedUrl }); c(); toast('Pinned'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
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

/* ── the community corkboard ──
   Digital sticky notes anyone with a key can pin: a short face on the
   board, the longer story on hover. Removals are one click and logged —
   the change feed is the moderation. */
let notePopEl = null;
function notePop() {
  if (!notePopEl) { notePopEl = h('div', { id: 'note-pop' }); document.body.appendChild(notePopEl); }
  return notePopEl;
}
function hideNotePop() { if (notePopEl) notePopEl.style.display = 'none'; }

async function loadBoard(card, rerender) {
  let d;
  try { d = await api.stickies({ op: 'list' }); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadBoard(card, rerender))); return; }
  clear(card);

  card.appendChild(sectionTitle('The Corkboard',
    h('span', { class: 'sec-sub' }, 'hover for the story'),
    h('button', { class: 'btn sm', onClick: () => stickerDialog(rerender) }, '+ Sticker'),
    h('button', {
      class: 'btn sm accent', onClick: () => {
        const msg = textInput({ maxLength: 60, placeholder: 'The short version (fits on the note)' });
        const det = h('textarea', { rows: 4, maxLength: 500, placeholder: 'The whole story — shows when someone hovers' });
        // one-tap emoji — they also just type in the field, this is the lazy row
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
              try { await api.stickies({ op: 'save', message: msg.value, detail: det.value, color: picked }); c(); toast('Pinned'); rerender(); }
              catch (err) { toast(err.message, 'err'); }
            } },
          ]);
      },
    }, '+ Note')));

  const notes = d.notes || [];
  if (!notes.length) {
    card.appendChild(h('div', { class: 'cork' },
      h('p', { class: 'cork-empty' }, 'Nothing pinned yet. Be the first — jokes, shout-outs, bug sightings, heads-ups.')));
    return;
  }

  card.appendChild(h('div', { class: 'cork' }, notes.map(n => {
    const tilt = ((n.id % 5) - 2) * 1.7;
    // A sticker pins straight to the cork — no paper, just the pushpin.
    const note = n.sticker_url
      ? h('div', { class: 'stk', style: { transform: `rotate(${tilt}deg)` } },
          h('i', { class: 'note-pin' }),
          h('img', { src: n.sticker_url, alt: n.message || 'sticker', loading: 'lazy' }),
          n.message ? h('span', { class: 'stk-cap' }, n.message) : null)
      : h('div', {
          class: 'note note-' + (n.color || 'yellow'),
          style: { transform: `rotate(${tilt}deg)` },
        },
          h('i', { class: 'note-pin' }),
          h('span', { class: 'note-msg' }, n.message),
          h('span', { class: 'note-by' }, '— ' + (n.author || '?')));
    note.addEventListener('mouseenter', () => {
      const e = notePop();
      clear(e).append(...[
        n.sticker_url ? h('img', { class: 'np-stk', src: n.sticker_url, alt: '' }) : null,
        n.message ? h('div', { class: 'np-msg' }, n.message) : null,
        n.detail ? h('div', { class: 'np-detail' }, n.detail) : null,
        h('div', { class: 'np-foot' }, `${n.author || '?'} · ${fmt.when(n.created_at)}`),
        h('div', { class: 'np-hint' }, 'right-click to take it down'),
      ].filter(Boolean));
      e.className = 'np-' + (n.color || 'yellow');
      e.style.display = 'block';
      const r = note.getBoundingClientRect ? note.getBoundingClientRect() : { left: 100, bottom: 100, top: 80 };
      const w = e.offsetWidth || 300;
      let x = Math.min(r.left, window.innerWidth - w - 16);
      let y = r.bottom + 8;
      if (y + (e.offsetHeight || 200) > window.innerHeight - 8) y = Math.max(8, r.top - (e.offsetHeight || 200) - 8);
      e.style.left = x + 'px'; e.style.top = y + 'px';
    });
    note.addEventListener('mouseleave', hideNotePop);
    note.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      hideNotePop();
      confirmBox('Take this note down?', `“${n.message}” comes off everyone's board. The change feed records who did it.`, async () => {
        try { await api.stickies({ op: 'delete', id: n.id }); toast('Note taken down'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      }, 'Take it down');
    });
    return note;
  })));
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

