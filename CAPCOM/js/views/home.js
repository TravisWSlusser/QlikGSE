/* home.js — CAPCOM's landing screen.

   Layout: the hotlinks line with your face on the right, then two columns.
   LEFT: both calendars behind tabs, your projects, your REC Room record
   with the leaders under it. RIGHT: the operations clocks, Learning
   Insights, the Community Board, the score ticker.

   Every card degrades by scope; a card a key can't open doesn't render,
   and a scoped key (no member behind it) gets the shared fallbacks rather
   than holes where the personal cards would be. */
import { h, clear, fmt, isPast, esc } from '../util.js';
import { api } from '../api.js';
import { spinner, errorState, sectionTitle, chip, emptyState, toast, modal, confirmBox, field, textInput } from '../ui.js';
import { giphyGrid } from '../giphy.js';
import { avatar, avatarEditor, avatarName } from '../avatar.js';
import { feedCard, setViewer } from '../timeline.js';
import { loadBoard, boardViewer } from '../board.js';
import { shapeProjects } from './projects.js';
import { ICONS } from '../icons.js';
import { wirePop } from '../pop.js';

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let ME = null;
let PEOPLE = null;   // Promise<shaped projects bundle> | null // the signed-in member's name — signatures come from the credential

export function render(params, rerender, who) {
  const scopes = (who && who.scopes) || [];
  ME = (who && who.member && who.member.name) || null;
  setViewer(who && who.member && who.member.id);
  /* ONE projects call for the whole page. Home's personal cards need the
     bundle, and so does the corkboard - a sticky stores a TYPED NAME, not
     a member id, so turning a signature into a face means looking the name
     up in the registry. Two calls for one payload would also mean the
     board could render before the registry landed and sign itself in
     plain text, then never correct itself. */
  PEOPLE = api.projects({ op: 'list', all: true })
    .then(d => shapeProjects(d, who))
    .catch(() => null);
  // AFTER the promise exists, not before — the board signs with a real
  // name and matches posters to faces, and both come from these two.
  boardViewer({ me: ME, people: PEOPLE });
  const root = h('div', { class: 'view' });

  /* ── the top line: hotlinks left, you on the right ──
     The avatar lived in the Operations clock's title row, which put it
     halfway down the page and made it look like a property OF the clock.
     It belongs where an account always belongs — the top right corner —
     and it rides the hotlinks line rather than claiming a row of its own.

     It is a SIBLING of .hlk-bar, never a child: loadHotlinks() clears that
     element to repaint the pills and would take the avatar with it. */
  const linkBar = h('div', { class: 'hlk-bar' }, spinner());
  root.appendChild(h('div', { class: 'home-top' }, linkBar, meCorner(who)));
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

  // Left column: the two calendars, your projects, your REC Room.
  const calCard = h('div', { class: 'card', dataset: { tour: 'calendar' } }, spinner());
  leftCol.appendChild(calCard);
  loadCalendar(calCard, scopes, acts, who);
  const prjCard = h('div', { class: 'card', dataset: { tour: 'projects-glance' } }, spinner());
  leftCol.appendChild(prjCard);
  // Your projects when CAPCOM knows who you are, the board's latest when it
  // does not (a scoped key is not a person). Same card either way.
  const recCard = h('div', { class: 'card', dataset: { tour: 'your-rec' } }, spinner());
  leftCol.appendChild(recCard);
  loadMine(prjCard, recCard, scopes, who);

  /* The Leadership Brief teaser is GONE from here. It is a full page in the
     sidebar for exactly the people who can open it, and a teaser for a page
     one click away was spending the best slot on the shortest trip.
     Latest Changes moved to Maintenance - a change feed is an audit trail,
     and the machine room is where you go looking for one. */

  /* Right column: the clock, Learning Insights, the corkboard, the scores.

     Learning Insights moved ABOVE the board: it is one line tall and the
     board is the tallest thing on the page, so below it the news sat past
     the fold on most screens and nobody read it.

     The score ticker takes the slot Insights left. It used to head the
     Stellar-Seller widget, which is gone - that section paired the hero
     banner set with the arcade back when they were two brands, and the
     arcade is just the REC Room now. Its three parts went where each one
     belongs: the ticker here, the leaderboard into the REC Room card on
     the left, and Most Missed onto the Questions page next to the
     questions it is talking about. */
  rightCol.appendChild(clockCard());
  /* The team timeline rides directly above Learning Insights: both are
     one band tall, and putting what people SAID above what the internet
     said is the right order for a page whose first job is the team. */
  const feed = h('div', { class: 'card tl-card', dataset: { tour: 'timeline' } }, spinner());
  rightCol.appendChild(feed);
  feedCard(feed, sectionTitle);
  const inspo = h('div', { class: 'card', dataset: { tour: 'news' } }, spinner());
  rightCol.appendChild(inspo);
  loadInspoCard(inspo);
  const board = h('div', { class: 'card board-card', dataset: { tour: 'board' } }, spinner());
  rightCol.appendChild(board);
  loadBoard(board, rerender);
  if (scopes.includes('analytics')) {
    const ticker = h('div', { class: 'card tk-card', dataset: { tour: 'scores' } }, spinner());
    rightCol.appendChild(ticker);
    loadTicker(ticker);
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

/* ── latest scores, as a ticker ──
 *
 * This was the banner across the top of the Stellar-Seller widget. That
 * section is gone, and the ticker is the part of it people actually
 * watched, so it gets a card of its own in the slot Learning Insights
 * left behind - same column, same width, one band tall.
 *
 * Hovering a trigram raises the full player card, the same one the
 * Dashboard and MT Roster use. The run is duplicated so the marquee loops
 * without a visible seam; the copy is aria-hidden so a screen reader
 * reads the scores once.
 */
async function loadTicker(card) {
  let a;
  try { a = await api.analytics(); }
  catch { card.remove(); return; }   // scores are a bonus, never an error card
  const excluded = a.excluded || [];
  const recent = a.recent || [];
  if (!recent.length) { card.remove(); return; }

  const statsByTrig = {};
  for (const p of a.top || []) statsByTrig[p.trigram] = p;

  const who = r => r.name || r.trigram;
  const one = (r, ghost) => {
    const it = h('span', { class: 'tk-item', 'aria-hidden': ghost ? 'true' : null },
      h('b', null, who(r)), ` +${fmt.int(r.points)} `, h('i', null, r.territory));
    if (!ghost) wirePop(it, statsByTrig[r.trigram], excluded);
    return it;
  };

  clear(card);
  card.appendChild(sectionTitle('Latest scores',
    h('a', { class: 'btn xs', href: '#dashboard' }, 'The whole board →')));
  card.appendChild(h('div', { class: 'tk-wrap' },
    h('span', { class: 'tk-label' }, 'RECENT'),
    h('div', { class: 'tk-window' },
      h('div', { class: 'tk-run' },
        recent.map(r => one(r, false)),
        recent.map(r => one(r, true))))));
}

/* meCorner(who) — the signed-in person, top right.
   A scoped key gets nothing here: there is no one to photograph, and an
   empty oval beside "Your profile" would be a dead end for the SMEs and
   contractors who hold those keys.
   The face carries the Update Avatar affordance on hover; at this size
   only the camera fits, so the button carries a title as well. */
function meCorner(who) {
  const me = (who && who.member) || null;
  if (!me) return null;
  return h('div', { class: 'home-me' },
    h('div', { class: 'home-me-tx' },
      h('button', { class: 'home-me-nm lnk', onClick: () => { location.hash = '#profile'; } }, me.name),
      h('span', { class: 'home-me-sub' }, 'Your profile →')),
    avatarEditor(me, 'md', () => { /* the element repaints itself */ }));
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

/* ── calendar widget rebuild (public feed — every key sees it) ── */
/* Every ISO day a feed event covers — the public feed calls the last day
   `end` (the admin list calls it end_date). Capped defensively. */
function feedSpanDays(e) {
  const out = [e.date];
  if (!e.end || e.end <= e.date) return out;
  const [y, m, d] = e.date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  for (let i = 0; i < 62; i++) {
    dt.setDate(dt.getDate() + 1);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    out.push(iso);
    if (iso >= e.end) break;
  }
  return out;
}
/* ── the calendar widget: BOTH calendars, one frame ──
 *
 * Enablement runs two that have nothing to do with each other:
 *
 *   MISSION CONTROL — the learner-facing feed, the same events the
 *     Mindtickle homepage renders. Colours come from event categories.
 *     Edited under Calendar; needs the 'calendar' scope to touch.
 *   TEAM — internal. Project phase deadlines, milestones and who is out
 *     of office. Colours come from project statuses. Edited from the
 *     Project Board; lives in full under Insights & Calendar.
 *
 * Same grid, same month nav, same upcoming list — only the source, the
 * legend and the footer links change. Tabs rather than two cards because
 * they answer the same question ("what is coming up?") for two different
 * audiences, and stacking two month grids would push everything below
 * them off the page.
 *
 * Out-of-office has NO DATE - ooo_note is free text ("Back Thursday") -
 * so it cannot sit on a day cell and is listed under the grid instead.
 * Inventing a date to pin it to would be worse than not showing it.
 */
async function loadCalendar(card, scopes, acts, who) {
  const canCal = scopes.includes('calendar');
  let pub = null, err = null;
  try { pub = await api.publicEvents(); }
  catch (e) { err = e; }
  if (err) { clear(card).appendChild(errorState(err, () => loadCalendar(card, scopes, acts, who))); return; }

  // the team side rides the bundle the rest of Home already fetched
  const team = await PEOPLE;

  let tab = 'mc';
  const head = h('div', { class: 'mc-head' });
  const gridEl = h('div', { class: 'mc-grid' });
  const listEl = h('div', { class: 'mc-list' });
  const legendEl = h('div', { class: 'mc-legend' });
  const footEl = h('div', { class: 'mc-foot' });
  let view = new Date(); view.setDate(1);

  /* Each tab returns the same shape: a map of ISO date -> entries, each
     with a colour, a label and an optional badge. Everything below draws
     from that and never asks which tab it is on. */
  const mcDays = () => {
    const cats = (pub && pub.categories) || {};
    const by = {};
    for (const e of (pub && pub.events) || []) {
      for (const iso of feedSpanDays(e)) {
        (by[iso] = by[iso] || []).push({
          title: e.title,
          color: (cats[e.category] || {}).color || 'var(--muted)',
          badge: null,
        });
      }
    }
    return by;
  };
  const teamDays = () => {
    const by = {};
    if (!team) return by;
    for (const pr of team.projects || []) {
      if (!pr.active || !pr.phase_due) continue;
      (by[pr.phase_due] = by[pr.phase_due] || []).push({
        title: pr.title,
        color: `var(--ps-${(team.statusById[pr.status_id] || {}).color || 'blue'})`,
        badge: pr.overdue ? 'OVERDUE' : 'DUE',
      });
    }
    for (const m of team.milestones || []) {
      if (!m.date) continue;
      (by[m.date] = by[m.date] || []).push({
        title: m.title, color: 'var(--link)', badge: 'MILE',
      });
    }
    return by;
  };

  const draw = () => {
    const byDate = tab === 'mc' ? mcDays() : teamDays();
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
          h('i', { style: { background: e.color } }))) : null);

      if (tab === 'mc' && canCal) {
        // With the calendar scope every day is a door: an occupied day
        // opens the Calendar view, an empty one deep-links into "new
        // event on this date".
        cell.style.cursor = 'pointer';
        if (!evs.length) cell.title = `Create an event on ${fmt.day(iso)}`;
        cell.addEventListener('click', () => {
          location.hash = evs.length ? '#calendar' : `#calendar/new/${iso}`;
        });
      } else if (tab === 'team' && evs.length) {
        // the team side is read-only here; deadlines are moved on the board
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => { location.hash = '#projects/insights'; });
      }
      gridEl.appendChild(cell);
    }

    // ---- upcoming, and the tab's own furniture ----
    clear(listEl); clear(legendEl); clear(footEl);
    if (tab === 'mc') {
      const cats = (pub && pub.categories) || {};
      const upcoming = ((pub && pub.events) || []).filter(e => !isPast(e.date, e.end)).slice(0, 3);
      listEl.append(...(upcoming.length
        ? upcoming.map(e => h('a', {
          class: 'mc-up', href: canCal ? '#calendar' : null,
          style: { '--evc': (cats[e.category] || {}).color || 'var(--muted)' },
        },
          h('span', { class: 'mc-up-date' },
            `${e.month} ${e.day}` + (e.end ? (e.end_month === e.month ? `–${e.end_day}` : ` – ${e.end_month} ${e.end_day}`) : '')),
          h('span', { class: 'mc-up-title' }, e.title)))
        : [h('p', { class: 'sub' }, 'Nothing upcoming on the calendar.')]));
      const seen = new Set(((pub && pub.events) || []).map(e => e.category).filter(Boolean));
      legendEl.append(...[...seen].slice(0, 5).map(k => h('span', { class: 'mc-leg' },
        h('i', { style: { background: (cats[k] || {}).color || 'var(--muted)' } }),
        (cats[k] || {}).label || k)));
      footEl.appendChild(h('a', { class: 'btn xs', href: '#calendar' },
        canCal ? 'Open the calendar →' : 'See the full calendar →'));
    } else {
      if (!team) {
        listEl.appendChild(h('p', { class: 'sub' }, 'The project board did not answer.'));
      } else {
        const byDate2 = teamDays();
        const upcoming = Object.keys(byDate2).sort().filter(iso => !isPast(iso))
          .flatMap(iso => byDate2[iso].map(e => ({ iso, ...e }))).slice(0, 3);
        listEl.append(...(upcoming.length
          ? upcoming.map(e => h('div', { class: 'mc-up', style: { '--evc': e.color } },
            h('span', { class: 'mc-up-date' }, fmt.day(e.iso)),
            h('span', { class: 'mc-up-title' }, e.title,
              e.badge === 'OVERDUE' ? h('span', { class: 'overdue-badge', style: { marginLeft: '8px' } }, 'OVERDUE') : null)))
          : [h('p', { class: 'sub' }, 'Nothing due on the projects calendar.')]));

        // who is out — no date to pin it to, so it lists under the grid
        const out = (team.members || []).filter(m => m.active && m.ooo_note);
        if (out.length) {
          listEl.appendChild(h('div', { class: 'mc-ooo' },
            h('span', { class: 'mc-ooo-lbl' }, 'Out of office'),
            ...out.map(m => h('span', { class: 'mc-ooo-row' },
              avatar(m, { size: 'xs' }),
              h('b', null, m.name), h('span', null, m.ooo_note)))));
        }
        legendEl.append(
          h('span', { class: 'mc-leg' }, h('i', { style: { background: 'var(--ps-teal)' } }), 'Phase due'),
          h('span', { class: 'mc-leg' }, h('i', { style: { background: 'var(--link)' } }), 'Milestone'));
      }
      footEl.appendChild(h('a', { class: 'btn xs', href: '#projects/insights' }, 'Insights & Calendar →'));
      footEl.appendChild(h('a', { class: 'btn xs', href: '#projects' }, 'Project Board →'));
    }
    // quick actions belong to the learner calendar, not the team one
    if (tab === 'mc' && acts && acts.length) {
      footEl.appendChild(h('div', { class: 'qa-row qa-under' }, acts));
    }
  };

  const tabBtn = (key, label) => h('button', {
    class: 'cal-tab' + (tab === key ? ' on' : ''),
    onClick: () => {
      if (tab === key) return;
      tab = key;
      [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === key));
      draw();
    },
    dataset: { k: key },
  }, label);
  const tabs = h('div', { class: 'cal-tabs' },
    tabBtn('mc', 'Mission Control'),
    tabBtn('team', 'Team'));

  clear(card).append(
    sectionTitle('Calendar', tabs),
    head, gridEl, legendEl, listEl, footEl);
  draw();
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
  const caret = h('button', { class: 'inspo-caret', 'aria-label': 'More learning insights', onClick: () => {
    card.classList.toggle('open');
    caret.textContent = card.classList.contains('open') ? '▴' : '▾';
  } }, '▾');

  card.append(h('div', { class: 'inspo-bar' },
    h('span', { class: 'inspo-label' }, 'Learning Insights'), line, caret), drawer);

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
/* Home's two personal cards, off ONE projects call.
 *
 * "Their info just populates the widgets when they log in" - the page is
 * the same page for everyone, and there is no per-person URL. The only
 * thing that varies is which rows these two cards find.
 *
 * A scoped key is not a person: it falls back to the board's latest
 * projects and a pointer at the scoreboard, so the layout never collapses
 * into holes for the SMEs and contractors who hold one.
 */
async function loadMine(prjCard, recCard, scopes, who) {
  const d = await PEOPLE;
  if (!d) {
    clear(prjCard).appendChild(errorState(new Error('The project board did not answer'),
      () => { PEOPLE = api.projects({ op: 'list', all: true }).then(x => shapeProjects(x, who)).catch(() => null);
        loadMine(prjCard, recCard, scopes, who); }));
    clear(recCard);
    return;
  }
  const me = d.meId ? d.memberById[d.meId] : null;

  // ---- projects ----
  clear(prjCard);
  const mine = me
    ? (d.tagsByMember[me.id] || []).map(id => d.projectById[id]).filter(Boolean)
      .filter(p => p.active)
      .sort((a, z) => new Date(z.updated_at || z.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    : null;
  const rows = (mine && mine.length ? mine : (d.projects || []).filter(p => p.active)).slice(0, 6);
  prjCard.appendChild(sectionTitle(mine && mine.length ? 'Your projects' : 'Projects',
    h('a', { class: 'btn xs', href: '#projects' }, 'Open the board'),
    ...(scopes.includes('projects') ? [h('a', { class: 'btn xs accent', href: '#projects/new' }, '+ New')] : [])));
  if (!rows.length) {
    prjCard.appendChild(emptyState(
      me ? 'You are not tagged on anything yet.' : 'No projects posted yet.',
      me ? 'Tag yourself from a project on the board and it shows up here.'
        : (scopes.includes('projects') ? 'Post the first one from the board.' : null)));
  } else {
    prjCard.appendChild(h('div', { class: 'prj-glance' }, rows.map(p => {
      const st = d.statusById[p.status_id];
      return h('a', { class: 'prj-glance-row', href: '#project/' + p.id },
        h('span', { class: 'prj-glance-title' }, p.title),
        h('span', { class: 'prj-glance-team' }, (d.teamById[p.team_id] || {}).name || ''),
        st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
        p.overdue
          ? h('span', { class: 'overdue-badge' }, 'OVERDUE')
          : h('span', { class: 'prj-glance-team' }, `due ${fmt.day(p.phase_due)}`));
    })));
  }

  // ---- your REC Room record, and who is ahead of you ----
  /* One card, because "how am I doing" and "who is winning" are the same
     glance. They were two widgets in two places - Your REC Room here and
     Leaders inside the Stellar-Seller strip - which meant reading your own
     score and the leaderboard took two trips down the page. */
  clear(recCard);
  const rec = me && me.trigram ? d.recByTri[me.trigram.toUpperCase()] : null;
  recCard.appendChild(sectionTitle('REC Room',
    h('a', { class: 'btn xs', href: '#dashboard' }, 'The whole board \u2192')));

  if (rec) {
    const acc = Number(rec.attempted) > 0
      ? Math.round((Number(rec.correct) / Number(rec.attempted)) * 100) : null;
    recCard.appendChild(h('p', { class: 'rec-you-lbl' }, 'Your record'));
    recCard.appendChild(h('div', { class: 'prof-rec-grid' },
      h('div', { class: 'prof-rec-stat' }, h('b', null, fmt.int(Number(rec.total_score))), h('span', null, 'Lifetime points')),
      h('div', { class: 'prof-rec-stat' }, h('b', null, fmt.int(Number(rec.games_played))), h('span', null, 'Runs')),
      h('div', { class: 'prof-rec-stat' },
        h('b', null, Number(rec.blitz_personal_high) > 0 ? fmt.int(Number(rec.blitz_personal_high)) : '\u2014'),
        h('span', null, 'Best run')),
      h('div', { class: 'prof-rec-stat' }, h('b', null, acc != null ? acc + '%' : '\u2014'), h('span', null, 'Accuracy'))));
  } else {
    recCard.appendChild(h('p', { class: 'sub rec-you-none' },
      me ? (me.trigram ? 'No runs recorded for you yet \u2014 play once and your record lands here.'
        : 'No trigram on your profile, so nothing links you to the arcade.')
        : 'Sign in as staff to see your own record.'));
  }

  // the leaderboard, off the analytics read - a separate call, so a slow
  // or missing arcade never holds up your own numbers above
  if (!scopes.includes('analytics')) return;
  const board = h('div', { class: 'rec-lead' }, h('p', { class: 'sub' }, 'Loading the board\u2026'));
  recCard.append(h('p', { class: 'rec-you-lbl' }, 'Leaders'), board);
  let a;
  try { a = await api.analytics(); } catch { board.remove(); return; }
  const excluded = a.excluded || [];
  // Staff never rank here either - a leaderboard is a leaderboard. They
  // stay visible and badged in the Dashboard table, where they're managed.
  const top = (a.top || [])
    .filter(x => !excluded.includes(x.trigram) && Number(x.total_score) > 0)
    .slice(0, 6);
  clear(board);
  if (!top.length) { board.appendChild(h('p', { class: 'sub' }, 'No players yet.')); return; }
  board.appendChild(h('div', { class: 'ld-list' }, top.map((x, i) => {
    const mine = me && me.trigram && x.trigram === me.trigram.toUpperCase();
    const row = h('div', { class: 'ld-row' + (mine ? ' ld-you' : ''), dataset: { trigram: x.trigram } },
      h('span', { class: 'ld-rank' }, String(i + 1)),
      h('span', { class: 'ld-who' }, x.name || x.trigram, mine ? h('i', null, 'you') : null),
      h('span', { class: 'ld-terr' }, x.territory),
      h('span', { class: 'ld-pts num' }, fmt.int(x.total_score)),
      h('span', { class: 'ld-acc num' }, fmt.pct(x.correct, x.attempted)));
    wirePop(row, x, excluded);
    return row;
  })));
}


