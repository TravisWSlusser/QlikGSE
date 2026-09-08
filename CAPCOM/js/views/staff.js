/* staff.js — the Staff tab as an ORG CHART. Travis: cards, not a
   drop-down list. Nick's card at the top, a line branching to the row
   of Enablement leaders, and the leaders with people get their reports
   broken out in a column beneath them. No team names anywhere — the
   org is just Global Sales Enablement; the people leaders simply carry
   different projects. Every card is one tap from the person's profile;
   leaders keep Invite and the ⋯ menu on the card. Reads are open to
   every key — the org chart is for everyone. */
import { h, clear } from '../util.js';
import { api } from '../api.js';
import { toast, confirmBox, sectionTitle, spinner, errorState, emptyState } from '../ui.js';
import { pctx, editMemberDialog, historyDialog, inviteDialog } from './projects.js';

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
  d.canManage = canEdit; // registry writes: managers + masters
  d.canInvite = canInvite;
  d.meId = meId || 0;    // the signed-in member, for self-service OOO
  d.recByTri = {};
  for (const r of d.recs || []) d.recByTri[(r.trigram || '').toUpperCase()] = r;
  clear(root);

  d.memberById = {};
  for (const m of d.members || []) d.memberById[m.id] = m;
  d.tagsByMember = {};
  for (const t of d.tags || []) (d.tagsByMember[t.member_id] = d.tagsByMember[t.member_id] || []).push(t.project_id);

  const members = (d.members || []).filter(m => m.active);
  const retired = (d.members || []).filter(m => !m.active);

  const card = h('div', { class: 'card' });
  card.appendChild(sectionTitle('Staff',
    h('span', { class: 'sec-sub' },
      `Global Sales Enablement · ${members.length} member${members.length === 1 ? '' : 's'} · tap a card for their profile`),
    ...(canEdit ? [h('button', { class: 'btn sm accent', onClick: () => editMemberDialog(null, d, rerender) }, '+ Add New')] : [])));
  if (canEdit) {
    card.appendChild(h('p', { class: 'sub org-how' },
      h('b', null, 'This section is exclusively for adding Sales Enablement staff. '),
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
  const react = async (m, emoji) => {
    try { await api.members({ op: 'statusReact', id: m.id, emoji }); rerender(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const statusLine = m => {
    if (!m.status_text || !m.active) return null;
    const groups = {};
    for (const r of reactsBy[m.id] || []) groups[r.emoji] = (groups[r.emoji] || 0) + 1;
    return h('div', { class: 'oc-status' },
      h('span', { class: 'cat-status-q' }, `“${m.status_text}”`),
      ...Object.entries(groups).map(([e, n]) =>
        h('span', { class: 'cat-react', title: (reactsBy[m.id] || []).filter(r => r.emoji === e).map(r => r.name).join(', ') },
          `${e}${n > 1 ? ' ' + n : ''}`)),
      h('span', {
        class: 'cat-react cat-react-add', role: 'button', title: 'React',
        onClick: ev => {
          ev.stopPropagation();
          pctx(ev.clientX, ev.clientY, REACT_SET.map(e => [e, () => react(m, e), false]));
        },
      }, '+'));
  };

  /* ── one card per person ── */
  const personCard = m => {
    const projCount = (d.tagsByMember[m.id] || []).length;
    const el = h('div', {
      class: 'org-card' + (m.active ? '' : ' prj-retired'),
      role: 'button', tabindex: '0',
      onClick: () => historyDialog(m, d),
    },
      h('div', { class: 'oc-head' },
        m.avatar_url ? h('img', { class: 'oc-avatar', src: m.avatar_url, alt: '' })
          : h('span', { class: 'oc-avatar oc-avatar-blank' }, (m.name || '?').slice(0, 1)),
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
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') historyDialog(m, d); });
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
