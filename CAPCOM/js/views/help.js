/* help.js — Help & FAQ: the walkthrough's blurbs in written form, a
   short FAQ, a replay button for the tour, and the bug report box.
   Deliberately flat — short blurbs, no ceremony. */
import { h, clear, esc, fmt } from '../util.js';
import { api } from '../api.js';
import { toast, field, textInput, textArea, sectionTitle, spinner, confirmBox } from '../ui.js';
import { startTour, resetTours } from '../tour.js';

const AREAS = [
  ['Home', 'The glance page: calendar, projects at a glance, the change feed, clocks, the Community Board and the news line.'],
  ['Calendar', 'The enablement calendar behind the Mission Control pages — events and categories, editable with the calendar scope.'],
  ['Focused Headlines', 'The rotating hero banners on Mission Control. What sellers see first.'],
  ['Action Banner', 'The Stellar-Seller action banner set — same mechanics, different stage.'],
  ['Project Board', 'Every project, its team, its status, and the date that status promised. Overdue rows demand a written what-happened before they move.'],
  ['Insights & Calendar', 'The board as charts: Gantt, status donuts, the projects calendar and the quarter review.'],
  ['Staff', 'The Sales Enablement org tree — people, trigrams, leaders and their reports. Managers add staff and issue invites here. SMEs and outside contributors do NOT go here.'],
  ['Tailored Access', 'Scoped keys for SMEs and other outside contributors — a key opens exactly the areas it names and nothing else.'],
  ['Maintenance', 'The machine room: the REC Room maintenance switch, the service keys the apps run on, and the Setup button.'],
  ['Dashboard', 'REC Room health: who is playing, scores, and how the systems behind it are doing.'],
  ['Players', 'Every player the arcade has seen, with their runs and territory.'],
  ['Questions', 'The three question banks the games draw from — knowledge, methodology, glossary.'],
  ['Community Board', 'The corkboard on Home. Notes, bookmarks, pictures, yarn. Signed with real names.'],
  ['Enablement News', 'A one-line rotating feed of sales-enablement and AI reading, cached server-side.'],
];

const FAQ = [
  ['How do I get access?', 'It is invite-only. A manager adds you to Staff and sends you a one-time invite code; at the gate you redeem it and set your own password (10+ characters, a number, a symbol).'],
  ['I forgot my password.', 'Ask a manager for a fresh one-time invite — redeeming it sets a new password. Your old one keeps working until the moment the new one lands.'],
  ['Why is a project marked OVERDUE?', 'Its current status promised a date and the date passed. The next status change requires a short written note about what happened — that is the accountability mechanic, not a punishment.'],
  ['What is the update banner?', 'When a deploy adds new pieces, managers and team leaders see a one-click banner to run Setup. Nobody has to remember it.'],
  ['Who are the managers?', 'The leadership circle Travis named. They hold every scope, sign the team up, and are the only ones who issue invites or reset codes.'],
  ['Can I turn the walkthroughs back on?', 'Right here — Replay the walkthroughs below resets all of them, and each page tours again the next time you open it. "Skip all tutorials" silences every page at once.'],
];

export function render(params, rerender, who) {
  const canResolve = !!(who && (who.master || who.manager));
  const root = h('div', { class: 'view' });

  const tourCard = h('div', { class: 'card' },
    sectionTitle('The walkthroughs',
      h('span', { class: 'sec-sub' }, 'every page has one — it plays the first time you open that page'),
      h('button', { class: 'btn sm accent', onClick: () => {
        resetTours(); toast('Walkthroughs reset — each page will tour again on your next visit');
        location.hash = '#home'; setTimeout(() => startTour('home', true), 700);
      } }, 'Replay the walkthroughs')));
  root.appendChild(tourCard);

  const areas = h('div', { class: 'card' }, sectionTitle('What each area is'));
  areas.appendChild(h('div', { class: 'help-grid' },
    ...AREAS.map(([t, b]) => h('div', { class: 'help-item' },
      h('div', { class: 'help-item-t' }, t), h('div', { class: 'help-item-b' }, b)))));
  root.appendChild(areas);

  const faq = h('div', { class: 'card' }, sectionTitle('FAQ'));
  for (const [q, a] of FAQ) {
    faq.appendChild(h('details', { class: 'faq-item' },
      h('summary', null, q), h('p', { class: 'faq-a' }, a)));
  }
  root.appendChild(faq);

  // ── bug reports ──
  const bugCard = h('div', { class: 'card' },
    sectionTitle('Report a bug', h('span', { class: 'sec-sub' }, 'goes to the managers and the change feed')));
  const where = textInput({ maxLength: 80, placeholder: 'Where? (e.g. Project Board)', value: '' });
  const what = textArea({ maxLength: 2000, placeholder: 'What happened, and what did you expect instead?' });
  const send = h('button', { class: 'btn sm accent', onClick: async () => {
    try {
      await api.bugs({ op: 'report', page: where.value, note: what.value });
      what.value = ''; toast('Reported — thank you');
      loadBugs();
    } catch (err) { toast(err.message, 'err'); }
  } }, 'Send report');
  bugCard.append(field('Where', where), field('What happened', what), send);
  const bugList = h('div', { class: 'bug-list' }, spinner());
  bugCard.appendChild(bugList);
  root.appendChild(bugCard);

  // ── about ──
  const TOOLS = [
    ['Hand-written HTML / CSS / JavaScript', 'Zero build step, no framework — every page is exactly what ships.'],
    ['Vercel', 'Hosting and the serverless functions behind /api. Push to main, live in a minute.'],
    ['Neon', 'Serverless Postgres — projects, staff, scores, the board, all of it.'],
    ['Mindtickle', 'Where Mission Control lives — the widgets embed there as custom HTML.'],
    ['GIPHY API', 'The Community Board’s stickers and sticker reactions.'],
    ['Web Audio API', 'The pops, blips and walkthrough sounds — synthesized, no audio files.'],
    ['Google Fonts', 'Inter for the interface; the arcade pages add Share Tech Mono and VT323.'],
    ['Qlik brand icon set', 'The sidebar icons, adapted to follow the theme.'],
    ['Claude Code (Anthropic)', 'AI pair-builder for the engineering, directed and designed by Travis.'],
  ];
  const about = h('div', { class: 'card' }, sectionTitle('About CAPCOM'));
  about.appendChild(h('p', { class: 'sub' },
    'The Command Operations Module — administration for Mission Control, the Project Board and the REC Room. Built on:'));
  about.appendChild(h('div', { class: 'about-list' },
    ...TOOLS.map(([t, b]) => h('div', null,
      h('div', { class: 'about-item-t' }, t), h('div', { class: 'about-item-b' }, b)))));
  about.appendChild(h('p', { class: 'about-credit' },
    'Designed & developed by ', h('b', null, 'Travis Slusser'),
    ' — Senior Learning Strategist, Qlik Global Sales Enablement.'));
  root.appendChild(about);

  async function loadBugs() {
    try {
      const r = await api.bugs({ op: 'list' });
      clear(bugList);
      const open = (r.reports || []).filter(x => !x.resolved);
      if (!open.length) { bugList.appendChild(h('p', { class: 'sub' }, 'No open bug reports.')); return; }
      for (const x of open) {
        bugList.appendChild(h('div', { class: 'bug-row' },
          h('span', { class: 'bug-note' }, x.note),
          h('span', { class: 'bug-meta' }, [x.page, x.actor].filter(Boolean).join(' · ')),
          canResolve ? h('button', { class: 'btn xs', onClick: () => confirmBox('Resolve this report?',
            'It drops off the open list; the change feed keeps the record.', async () => {
              try { await api.bugs({ op: 'resolve', id: x.id }); toast('Resolved'); loadBugs(); }
              catch (err) { toast(err.message, 'err'); }
            }, 'Resolve') }, 'Resolve') : null));
      }
    } catch (err) {
      clear(bugList).appendChild(h('p', { class: 'sub' }, 'Bug list unavailable — run Setup for v4.'));
    }
  }
  loadBugs();

  return root;
}
