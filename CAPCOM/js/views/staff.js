/* staff.js — the Staff tab as an ORG CHART. Travis: cards, not a
   drop-down list. Nick's card at the top, a line branching to the row
   of Enablement leaders, and the leaders with people get their reports
   broken out in a column beneath them. No team names anywhere — the
   org is just Global Sales Enablement; the people leaders simply carry
   different projects. Every card is one tap from the person's profile;
   leaders keep Invite and the ⋯ menu on the card. Reads are open to
   every key — the org chart is for everyone. */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import { toast, confirmBox, sectionTitle, spinner, errorState, emptyState, modal } from '../ui.js';
import { pctx, editMemberDialog, inviteDialog, shapeProjects } from './projects.js';
import { preview } from '../preview.js';
import { avatar, put } from '../avatar.js';
import { giphyGrid } from '../giphy.js';
import { openThread } from '../timeline.js';

/* One hover panel for the whole page - the same single-node pattern
   pop.js and avatar.js use. A panel per card would be sixty detached
   subtrees on a team this size. */
let staffPopEl = null;
/* Exported because a ROUTE CHANGE never fires mouseleave on the card that
   raised this - the card is simply gone, and the panel floats over the
   next page forever. app.js closes it on every draw, the same way it
   closes the player stat card and the avatar tooltip. */
export function hideStaffPop() { if (staffPopEl) staffPopEl.style.display = 'none'; }

/* Areas a non-manager can be granted (v12). Must match GRANTABLE in
   lib/admin/auth.js — the server re-filters on write AND on read, so a
   mismatch here is a cosmetic bug, never a privilege one. Maintenance and
   key minting are deliberately absent: those ride the Manager checkbox. */
/* a manager previews as holding everything, which is what auth.js gives them */
const SCOPES_ALL = ['calendar', 'banners', 'content', 'analytics', 'projects', 'access', 'system'];
const AREAS = [
  ['calendar',  'Calendar',      'Mission Control events'],
  ['banners',   'Hero Banners',  'the homepage rotators'],
  ['content',   'Questions',     'all three REC Room banks'],
  ['analytics', 'Analytics',     'player and game data, read-only'],
  ['access',    'Tailored Access', 'see who holds which key — read-only, cannot mint or revoke'],
];

function accessDialog(m, rerender) {
  if (m.is_manager) {
    return modal(`${m.name}'s access`,
      h('p', { class: 'confirm-msg' },
        `${m.name} is a manager and already holds every area. Clear the Manager checkbox in Edit first if they should only have specific ones.`),
      [{ label: 'Close', onClick: c => c() }]);
  }
  const have = new Set(m.scopes || []);
  const boxes = AREAS.map(([key, label, hint]) => {
    const cb = h('input', { type: 'checkbox', checked: have.has(key) });
    return { key, cb, row: h('label', { class: 'field access-row' }, cb,
      h('span', null, h('b', null, label), ' — ', hint)) };
  });
  modal(`${m.name}'s access`,
    h('div', null,
      h('p', { class: 'field-hint' },
        'Tick the areas they can work in. They sign in with their usual trigram and code — nothing extra to paste. Leave everything unticked and they keep Home and Projects only.'),
      ...boxes.map(b => b.row)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Save access', kind: 'accent', onClick: async c => {
        const scopes = boxes.filter(b => b.cb.checked).map(b => b.key);
        try {
          await api.members({ op: 'setScopes', id: m.id, scopes });
          c(); toast(scopes.length ? 'Access updated' : 'Access removed'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

export function render(params, rerender, who) {
  // registry rights (add/edit members, reset codes): managers + masters only
  const canEdit = !!(who && (who.master || who.manager));
  // logins (activation keys, resets): core leadership + masters
  const canInvite = !!(who && (who.master || who.manager));
  const meId = (who && who.member && who.member.id) || 0;
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, canEdit, meId, canInvite);
  return root;
}

async function load(root, rerender, canEdit, meId, canInvite) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, canEdit, meId, canInvite))); return; }
  shapeProjects(d, { master: canEdit, manager: canEdit, member: meId ? { id: meId } : null });
  d.canInvite = canInvite;
  clear(root);

  const members = (d.members || []).filter(m => m.active);
  const retired = (d.members || []).filter(m => !m.active);

  const card = h('div', { class: 'card' });
  card.appendChild(sectionTitle('Our Organization',
    h('span', { class: 'sec-sub' },
      `Global Sales Enablement · ${members.length} member${members.length === 1 ? '' : 's'} · tap a card for their profile`),
    ...(canEdit ? [h('button', { class: 'btn sm accent', onClick: () => editMemberDialog(null, d, rerender) }, '+ Add New')] : [])));
  if (canEdit) {
    card.appendChild(h('p', { class: 'sub org-how' },
      h('b', null, 'This page is the Sales Enablement org, and only that. '),
      'Do not add SMEs or other content providers here — they get scoped keys from Tailored Access instead. ',
      'For staff: Sales Enablement leaders click Invite on a person’s card to create their activation key, then send it to them to begin their CAPCOM onboarding. At the gate they choose Activate, enter trigram + key, and set their own password. Invite again any time to reset one.'));
  }

  if (!members.length) {
    card.appendChild(emptyState('Nobody on staff yet.',
      canEdit ? '+ Add New puts the first person in — name and REC Room trigram.'
        : 'The team appears here as it gets established.'));
    root.appendChild(card);
    return;
  }

  const menuFor = m => [
    ['Edit…', () => editMemberDialog(m, d, rerender), false],
    ...(canEdit ? [['Access…', () => accessDialog(m, rerender), false]] : []),
    /* LEADER-LEVEL ONLY — canEdit is master || manager. Nothing about a
       preview changes anyone's access, but it rearranges YOUR sidebar,
       and watching that happen would alarm the person sitting beside you.
       It is also read-only throughout: api.js refuses every write while a
       preview runs, so one can never post or react as the person being
       previewed. */
    ...(canEdit ? [['Preview their view (look-only)', () => preview.set({
      name: m.name,
      scopes: m.is_manager ? SCOPES_ALL : (m.scopes || []),
    }), false]] : []),
    ...(canInvite ? [['Activation key…', () => inviteDialog(m), false]] : []),
    ...(canInvite && m.claimed ? [['Reset access code', () => confirmBox('Reset this access code?',
      `${m.name}'s member sign-in stops working until they claim a new code at the gate.`, async () => {
        try { await api.members({ op: 'resetCode', id: m.id }); toast('Code reset'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      }, 'Reset it'), false]] : []),
    [m.active ? 'Retire' : 'Restore', () => confirmBox(m.active ? 'Retire this member?' : 'Restore this member?',
      m.active ? `${m.name} comes off the staff — their project history stays.` : `${m.name} rejoins the staff.`, async () => {
        try { await api.members({ op: 'retire', id: m.id, restore: !m.active }); toast(m.active ? 'Member retired' : 'Member restored'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      }, m.active ? 'Retire' : 'Restore'), m.active],
  ];

  // reactions on status posts, grouped per member
  const reactsBy = {};
  for (const r of d.staffReacts || []) {
    (reactsBy[r.member_id] = reactsBy[r.member_id] || []).push(r);
  }
  const REACT_SET = ['👍', '🎉', '🔥', '😂', '💚', '👏'];
  const react = async (m, body) => {
    try { await api.timeline({ op: 'react', kind: 'status', id: m.id, ...body }); rerender(); }
    catch (err) { toast(err.message, 'err'); }
  };
  /* A sticker or a meme, not just an emoji - the same GIPHY drawer the
     corkboard uses, so "react to it" means the same thing in both places. */
  const stickerReact = m => {
    let picked = '';
    modal(`React to ${m.name}`, giphyGrid(url => { picked = url; }), [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Stick it on', kind: 'accent', onClick: async c => {
        if (!picked) { toast('Pick one first', 'err'); return; }
        c(); react(m, { sticker_url: picked });
      } },
    ]);
  };
  const statusLine = m => {
    if (!m.status_text || !m.active) return null;
    const mine = reactsBy[m.id] || [];
    const groups = {};
    for (const r of mine) if (r.emoji) (groups[r.emoji] = groups[r.emoji] || []).push(r.name);
    return h('div', { class: 'oc-status' },
      h('span', {
        class: 'cat-status-q tl-click', role: 'button', tabindex: '0',
        title: 'Open this status',
        onClick: ev => { ev.stopPropagation(); openThread({ kind: 'status', id: m.id }, rerender); },
      }, `“${m.status_text}”`),
      ...Object.entries(groups).map(([e, names]) =>
        h('span', { class: 'cat-react', title: names.join(', ') },
          `${e}${names.length > 1 ? ' ' + names.length : ''}`)),
      ...mine.filter(r => r.sticker_url).map(r =>
        h('img', { class: 'cat-react-img', src: r.sticker_url, alt: '', title: r.name, loading: 'lazy' })),
      /* Your own status shows its reactions but offers no button to add
         one — and it has to SAY so. An affordance that is simply absent
         is indistinguishable from one that is broken, and on a team where
         one person has posted, the only status on the page is your own. */
      preview.active()
        ? null                       // a preview reads statuses, never reacts
        : m.id === meId
        ? h('span', { class: 'cat-mine', title: 'Others can react to this — you cannot react to your own' }, 'yours')
        : h('span', {
          class: 'cat-react cat-react-add', role: 'button', title: 'React',
          onClick: ev => {
            ev.stopPropagation();
            pctx(ev.clientX, ev.clientY, [
              ...REACT_SET.map(e => [e, () => react(m, { emoji: e }), false]),
              ['Sticker / meme…', () => stickerReact(m), false],
            ]);
          },
        }, '+'),
      // every status, yours included, gets a visible door into its thread
      h('span', {
        class: 'cat-react cat-open', role: 'button', title: 'Open — comments and reactions',
        onClick: ev => { ev.stopPropagation(); openThread({ kind: 'status', id: m.id }, rerender); },
      }, '💬'));
  };

  /* ── the hover peek ──
     Travis asked to hover a person and see their status, their projects
     and their REC Room stats. That is the profile page, so this shows the
     same things in the same order and says where the rest lives.

     READ-ONLY on purpose. The reaction buttons stay on the card itself,
     because a control inside a hover panel is a control you have to chase
     with the mouse - the panel closes the moment you leave the card. */
  const staffPop = () => {
    if (!staffPopEl) { staffPopEl = h('div', { id: 'staff-pop' }); document.body.appendChild(staffPopEl); }
    return staffPopEl;
  };
  const showStaffPop = (anchor, m, dd) => {
    const e = clear(staffPop());
    const projs = (dd.tagsByMember[m.id] || []).map(id => dd.projectById[id]).filter(Boolean);
    const active = projs.filter(p => p.active);
    const rec = m.trigram ? dd.recByTri[(m.trigram || '').toUpperCase()] : null;
    const acc = rec && Number(rec.attempted) > 0
      ? Math.round((Number(rec.correct) / Number(rec.attempted)) * 100) : null;
    put(e,
      h('div', { class: 'sp-head' },
        avatar(m, { size: 'md', link: false }),
        h('div', null,
          h('b', null, m.name),
          h('span', { class: 'sub' }, m.title || (m.is_leader ? 'People leader' : 'Team member')))),
      m.ooo_note ? h('p', { class: 'sp-ooo' }, `Out of office — ${m.ooo_note}`) : null,
      m.status_text ? h('blockquote', { class: 'sp-quote' }, m.status_text) : null,
      h('div', { class: 'sp-sec' },
        h('span', { class: 'sp-lbl' }, active.length ? `Projects · ${active.length} active` : 'Projects'),
        active.length
          ? h('ul', { class: 'sp-list' }, active.slice(0, 5).map(p => h('li', null, p.title)))
          : h('p', { class: 'sub' }, 'Not tagged on anything yet.')),
      h('div', { class: 'sp-sec' },
        h('span', { class: 'sp-lbl' }, 'REC Room'),
        rec
          ? h('div', { class: 'sp-rec' },
            h('span', null, h('b', null, fmt.int(Number(rec.total_score))), ' pts'),
            h('span', null, h('b', null, fmt.int(Number(rec.games_played))), ' runs'),
            acc != null ? h('span', null, h('b', null, acc + '%'), ' accuracy') : null)
          : h('p', { class: 'sub' }, m.trigram ? 'No runs yet.' : 'No trigram.')),
      h('p', { class: 'sp-go' }, 'Click for the full profile →'));
    e.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const w = e.offsetWidth, hh = e.offsetHeight;
    // prefer the right of the card, flip left at the edge, clamp vertically
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = r.left - w - 10;
    e.style.left = Math.max(8, left) + 'px';
    e.style.top = Math.max(8, Math.min(window.innerHeight - hh - 8, r.top)) + 'px';
  };

  /* ── one card per person ── */
  const personCard = m => {
    const projCount = (d.tagsByMember[m.id] || []).length;
    const el = h('div', {
      class: 'org-card' + (m.active ? '' : ' prj-retired'),
      role: 'button', tabindex: '0',
      // the card is a door to the profile PAGE now; hover is the peek
      onClick: () => { hideStaffPop(); location.hash = '#profile/' + m.id; },
    },
      h('div', { class: 'oc-head' },
        // one avatar component everywhere - the default is a person icon,
        // not an initial, which reads as a broken image
        avatar(m, { size: 'md' }),
        h('div', { class: 'oc-id' },
          h('div', { class: 'oc-name' }, m.name),
          h('div', { class: 'oc-title' }, m.title || (m.is_leader ? 'People leader' : 'Team member'))),
        m.trigram ? h('span', { class: 'mem-row-tri' }, m.trigram) : null),
      m.ooo_note ? h('div', { class: 'oc-ooo' }, `OOO — ${m.ooo_note}`) : null,
      statusLine(m),
      h('div', { class: 'oc-foot' },
        h('span', { class: 'oc-meta' }, [
          projCount ? `${projCount} project${projCount > 1 ? 's' : ''}` : null,
          m.active && !m.claimed ? 'no access yet' : null,
        ].filter(Boolean).join(' · ')),
        canInvite && m.active ? h('span', {
          class: 'btn xs cat-invite', role: 'button',
          title: m.claimed ? 'Issue a fresh activation key (also works as a password reset)' : 'Issue their activation key',
          onClick: ev => { ev.stopPropagation(); inviteDialog(m); },
        }, 'Invite') : null,
        canEdit ? h('span', { class: 'itm-menu mem-row-menu', role: 'button', 'aria-label': 'Member menu', onClick: ev => {
          ev.stopPropagation();
          pctx(ev.clientX, ev.clientY, menuFor(m));
        } }, '⋯') : null));
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { hideStaffPop(); location.hash = '#profile/' + m.id; }
    });
    // the peek: everything the profile page has, read-only, without leaving
    el.addEventListener('mouseenter', () => showStaffPop(el, m, d));
    el.addEventListener('mouseleave', hideStaffPop);
    if (canEdit) el.addEventListener('contextmenu', ev => { ev.preventDefault(); pctx(ev.clientX, ev.clientY, menuFor(m)); });
    return el;
  };

  /* ── the chart: root card, a rail to the leadership row, reports in
        a column under their leader (recursing for deeper lines) ── */
  const reportsOf = id => members.filter(x => x.manager_id === id)
    .sort((a, b) => (b.is_leader - a.is_leader) || a.name.localeCompare(b.name));
  const placed = new Set();

  const branch = (m, depth) => {
    // a card plus, beneath it, a column of its reports (stem-connected)
    placed.add(m.id);
    const kids = depth > 6 ? [] : reportsOf(m.id).filter(k => !placed.has(k.id));
    const el = h('div', { class: 'org-branch' }, personCard(m));
    if (kids.length) {
      el.appendChild(h('div', { class: 'org-reports' },
        ...kids.map(k => h('div', { class: 'org-vcell' }, branch(k, depth + 1)))));
    }
    return el;
  };

  const roots = members
    .filter(m => !m.manager_id || !d.memberById[m.manager_id] || !d.memberById[m.manager_id].active)
    .sort((a, b) => (b.is_leader - a.is_leader) || a.name.localeCompare(b.name))
    .filter(m => m.is_leader || reportsOf(m.id).length);

  const chartWrap = h('div', { class: 'org-chart-scroll' });
  for (const rootM of roots) {
    if (placed.has(rootM.id)) continue;
    placed.add(rootM.id);
    const tier = reportsOf(rootM.id).filter(k => !placed.has(k.id));
    const chart = h('div', { class: 'org-chart' }, personCard(rootM));
    if (tier.length) {
      chart.appendChild(h('div', { class: 'org-stem' }));
      chart.appendChild(h('div', { class: 'org-tier' },
        ...tier.map(k => h('div', { class: 'org-cell' }, branch(k, 1)))));
    }
    chartWrap.appendChild(chart);
  }
  card.appendChild(chartWrap);

  // active people with no line into the chart yet — say so, don't hide them
  const loose = members.filter(m => !placed.has(m.id));
  if (loose.length) {
    card.appendChild(h('div', { class: 'cat-team-name org-bucket' }, 'No reporting line yet'));
    card.appendChild(h('div', { class: 'org-grid' }, ...loose.map(personCard)));
    if (canEdit) card.appendChild(h('p', { class: 'sub' },
      'Edit a person and set “Reports to” to place them on the chart.'));
  }
  if (canEdit && retired.length) {
    card.appendChild(h('div', { class: 'cat-team-name org-bucket' }, 'Retired'));
    card.appendChild(h('div', { class: 'org-grid' }, ...retired.map(personCard)));
  }
  // SMEs and outside contributors do not belong on the org chart — point
  // the targeted-access cases at key generation instead
  if (canEdit) {
    card.appendChild(h('div', { class: 'staff-access-bar' },
      h('span', null, 'Need to give an SME or outside contributor targeted access? That’s a scoped key, not a staff entry.'),
      h('a', { class: 'btn sm', href: '#projects/access' }, 'Open Tailored Access →')));
  }
  root.appendChild(card);
}
