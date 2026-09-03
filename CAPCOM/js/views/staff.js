/* staff.js — the Staff tab: where the GSE team and its leadership get
   established. Teams as columns, the leader starred at the top of each,
   everyone one click from their project history. With the projects
   scope: + Add New, a Teams manager (where leaders are crowned), and
   right-click on any person to edit, reset their access code, or
   retire them (touch gets the ⋯ chip). Reads are open to every key —
   the org chart is for everyone. */
import { h, clear } from '../util.js';
import { api } from '../api.js';
import { toast, confirmBox, sectionTitle, spinner, errorState, emptyState } from '../ui.js';
import { pctx, editMemberDialog, teamsDialog, historyDialog, inviteDialog } from './projects.js';

export function render(params, rerender, who) {
  const canTeams = !!(who && who.scopes && who.scopes.includes('projects'));
  // registry rights (add/edit members, reset codes): managers + masters only
  const canEdit = !!(who && (who.master || who.manager));
  // logins (activation keys, resets): core leadership + masters
  const canInvite = !!(who && (who.master || who.manager));
  const meId = (who && who.member && who.member.id) || 0;
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, canEdit, canTeams, meId, canInvite);
  return root;
}

async function load(root, rerender, canEdit, canTeams, meId, canInvite) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, canEdit, canTeams, meId, canInvite))); return; }
  d.canManage = canEdit; // registry writes: managers + masters
  d.meId = meId || 0;    // the signed-in member, for self-service OOO
  d.recByTri = {};
  for (const r of d.recs || []) d.recByTri[(r.trigram || '').toUpperCase()] = r;
  clear(root);

  d.memberById = {};
  for (const m of d.members || []) d.memberById[m.id] = m;
  d.tagsByMember = {};
  for (const t of d.tags || []) (d.tagsByMember[t.member_id] = d.tagsByMember[t.member_id] || []).push(t.project_id);
  const teamById = {};
  for (const t of d.teams) teamById[t.id] = t;

  const members = (d.members || []).filter(m => m.active);
  const retired = (d.members || []).filter(m => !m.active);

  const card = h('div', { class: 'card' });
  card.appendChild(sectionTitle('Staff',
    h('span', { class: 'sec-sub' },
      `${members.length} member${members.length === 1 ? '' : 's'} · the org from the top down — reports sit under their leader`),
    ...(canTeams ? [h('button', { class: 'btn sm', onClick: () => teamsDialog(d, rerender) }, 'Teams')] : []),
    ...(canEdit ? [h('button', { class: 'btn sm accent', onClick: () => editMemberDialog(null, d, rerender) }, '+ Add New')] : [])));
  if (canEdit) {
    card.appendChild(h('p', { class: 'sub org-how' },
      h('b', null, 'This section is exclusively for adding Sales Enablement staff. '),
      'Do not add SMEs or other content providers here — they get scoped keys from Tailored Access instead. ',
      'For staff: people leaders click Invite on a person’s row to create their activation key, then send it to them to begin their CAPCOM onboarding. At the gate they choose Activate, enter trigram + key, and set their own password. Invite again any time to reset one.'));
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

  /* The staff view is the ORG TREE, top level down (Travis: "Nick is
     the leader of everyone") — the reporting line (manager_id) is the
     structure; teams become a detail on the row. Roots are the people
     nobody above them: leaders first, so the head of the org tops the
     page, with everyone's reports nested and indented beneath them. */
  const leaderTeams = {};
  for (const t of d.teams.filter(t => t.active)) {
    if (t.leader_id) (leaderTeams[t.leader_id] = leaderTeams[t.leader_id] || []).push(t.name);
  }
  const teamName = id => { const t = d.teams.find(x => x.id === id); return t ? t.name : null; };

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
    return h('span', { class: 'cat-status' },
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

  const memberRow = (m, depth) => {
    const projCount = (d.tagsByMember[m.id] || []).length;
    const teamLead = !!leaderTeams[m.id];
    const row = h('button', {
      class: 'cat-member' + (teamLead ? ' cat-lead' : '') + (depth > 0 ? ' cat-report' : '') + (m.active ? '' : ' prj-retired'),
      style: depth > 0 ? { paddingLeft: (10 + depth * 26) + 'px' } : undefined,
      onClick: () => historyDialog(m, d),
    },
      teamLead ? h('span', { class: 'cat-star', 'aria-label': 'Team leader' }, '★') : h('span', { class: 'cat-star' }, ''),
      m.avatar_url ? h('img', { class: 'cat-avatar', src: m.avatar_url, alt: '' })
        : h('span', { class: 'cat-avatar cat-avatar-blank' }, (m.name || '?').slice(0, 1)),
      h('span', { class: 'cat-name' }, m.name),
      m.trigram ? h('span', { class: 'mem-row-tri' }, m.trigram) : null,
      h('span', { class: 'cat-detail' }, [
        teamLead ? `leads ${leaderTeams[m.id].join(' + ')}` : null,
        m.is_leader ? 'People leader' : null,
        m.title || null,
        teamName(m.team_id),
        m.ooo_note ? `OOO — ${m.ooo_note}` : null,
        m.active && !m.claimed ? 'no access yet' : null,
      ].filter(Boolean).join(' · ')),
      h('span', { class: 'cat-count' }, projCount ? `${projCount} project${projCount > 1 ? 's' : ''}` : ''),
      canInvite && m.active ? h('span', {
        class: 'btn xs cat-invite', role: 'button',
        title: m.claimed ? 'Issue a fresh activation key (also works as a password reset)' : 'Issue their activation key',
        onClick: ev => { ev.stopPropagation(); inviteDialog(m); },
      }, 'Invite') : null,
      canEdit ? h('span', { class: 'itm-menu mem-row-menu', role: 'button', 'aria-label': 'Member menu', onClick: ev => {
        ev.stopPropagation();
        pctx(ev.clientX, ev.clientY, menuFor(m));
      } }, '⋯') : null,
      statusLine(m));
    if (canEdit) row.addEventListener('contextmenu', ev => { ev.preventDefault(); pctx(ev.clientX, ev.clientY, menuFor(m)); });
    return row;
  };

  const reportsOf = id => members.filter(x => x.manager_id === id)
    .sort((a, b) => (b.is_leader - a.is_leader) || a.name.localeCompare(b.name));
  const tree = h('div', { class: 'org-tree' });
  const placed = new Set();
  const walk = (m, depth) => {
    if (placed.has(m.id) || depth > 8) return; // cycle / depth guard
    placed.add(m.id);
    tree.appendChild(memberRow(m, depth));
    for (const r of reportsOf(m.id)) walk(r, depth + 1);
  };
  // roots: nobody above them (no manager, or the manager is gone) —
  // leaders first so the top of the org tops the page
  const roots = members
    .filter(m => !m.manager_id || !d.memberById[m.manager_id] || !d.memberById[m.manager_id].active)
    .sort((a, b) => (b.is_leader - a.is_leader) || a.name.localeCompare(b.name));
  for (const m of roots.filter(x => x.is_leader)) walk(m, 0);
  card.appendChild(tree);

  // active people with no line into the tree yet — say so, don't hide them
  const loose = members.filter(m => !placed.has(m.id));
  if (loose.length) {
    card.appendChild(h('div', { class: 'cat-team-name org-bucket' }, 'No reporting line yet'));
    const bucket = h('div', { class: 'org-tree' });
    for (const m of loose) bucket.appendChild(memberRow(m, 0));
    card.appendChild(bucket);
    if (canEdit) card.appendChild(h('p', { class: 'sub' },
      'Edit a person and set “Reports to” to place them in the tree.'));
  }
  if (canEdit && retired.length) {
    card.appendChild(h('div', { class: 'cat-team-name org-bucket' }, 'Retired'));
    const bucket = h('div', { class: 'org-tree' });
    for (const m of retired) bucket.appendChild(memberRow(m, 0));
    card.appendChild(bucket);
  }
  // SMEs and outside contributors do not belong in the org tree — point
  // the targeted-access cases at key generation instead
  if (canEdit) {
    card.appendChild(h('div', { class: 'staff-access-bar' },
      h('span', null, 'Need to give an SME or outside contributor targeted access? That’s a scoped key, not a staff entry.'),
      h('a', { class: 'btn sm', href: '#projects/access' }, 'Open Tailored Access →')));
  }
  root.appendChild(card);
}
