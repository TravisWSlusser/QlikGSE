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
import { pctx, editMemberDialog, teamsDialog, historyDialog } from './projects.js';

export function render(params, rerender, who) {
  const canTeams = !!(who && who.scopes && who.scopes.includes('projects'));
  // registry rights (add/edit members, reset codes): managers + masters only
  const canEdit = !!(who && (who.master || who.manager));
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, canEdit, canTeams);
  return root;
}

async function load(root, rerender, canEdit, canTeams) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, canEdit, canTeams))); return; }
  d.canManage = canEdit; // registry writes: managers + masters
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
      `${members.length} member${members.length === 1 ? '' : 's'} · leaders keep the app updated and top their team's column`),
    ...(canTeams ? [h('button', { class: 'btn sm', onClick: () => teamsDialog(d, rerender) }, 'Teams')] : []),
    ...(canEdit ? [h('button', { class: 'btn sm accent', onClick: () => editMemberDialog(null, d, rerender) }, '+ Add New')] : [])));

  if (!members.length) {
    card.appendChild(emptyState('Nobody on staff yet.',
      canEdit ? '+ Add New puts the first person in — name and REC Room trigram.'
        : 'The team appears here as it gets established.'));
    root.appendChild(card);
    return;
  }

  const menuFor = m => [
    ['Edit…', () => editMemberDialog(m, d, rerender), false],
    ...(m.claimed ? [['Reset access code', () => confirmBox('Reset this access code?',
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

  const memberRow = (m, isLead, isReport) => {
    const projCount = (d.tagsByMember[m.id] || []).length;
    const mgr = m.manager_id ? d.memberById[m.manager_id] : null;
    const row = h('button', {
      class: 'cat-member' + (isLead ? ' cat-lead' : '') + (isReport ? ' cat-report' : '') + (m.active ? '' : ' prj-retired'),
      onClick: () => historyDialog(m, d),
    },
      isLead ? h('span', { class: 'cat-star', 'aria-label': 'Team leader' }, '★') : h('span', { class: 'cat-star' }, ''),
      h('span', { class: 'cat-name' }, m.name),
      m.trigram ? h('span', { class: 'mem-row-tri' }, m.trigram) : null,
      h('span', { class: 'cat-detail' }, [
        isLead ? 'Team leader' : null,
        m.is_leader ? 'People leader' : null,
        m.title || null,
        // a report's line is shown by the nesting; name the manager only
        // when they sit outside this leader's stack
        !isReport && mgr ? `reports to ${mgr.name}` : null,
      ].filter(Boolean).join(' · ')),
      h('span', { class: 'cat-count' }, projCount ? `${projCount} project${projCount > 1 ? 's' : ''}` : ''),
      canEdit ? h('span', { class: 'itm-menu mem-row-menu', role: 'button', 'aria-label': 'Member menu', onClick: ev => {
        ev.stopPropagation();
        pctx(ev.clientX, ev.clientY, menuFor(m));
      } }, '⋯') : null);
    if (canEdit) row.addEventListener('contextmenu', ev => { ev.preventDefault(); pctx(ev.clientX, ev.clientY, menuFor(m)); });
    return row;
  };

  const grid = h('div', { class: 'cat-grid' });
  const placed = new Set();
  for (const t of d.teams.filter(t => t.active)) {
    const teamLead = t.leader_id ? d.memberById[t.leader_id] : null;
    const crew = members.filter(m => m.team_id === t.id);
    if (!(teamLead && teamLead.active) && !crew.length) continue;
    const col = h('div', { class: 'cat-team' }, h('div', { class: 'cat-team-name' }, t.name));
    // hierarchy inside the column: people leaders first (the team's own
    // leader on top), each with their reports nested under them, then
    // everyone unattached
    const add = (m, isLead, isReport) => {
      if (placed.has(m.id)) return;
      col.appendChild(memberRow(m, isLead, isReport));
      placed.add(m.id);
      if (m.is_leader) {
        for (const r of members.filter(x => x.manager_id === m.id && x.team_id === t.id)) add(r, false, true);
      }
    };
    if (teamLead && teamLead.active) add(teamLead, true, false);
    for (const m of crew.filter(x => x.is_leader)) add(m, false, false);
    for (const m of crew) add(m, false, false);
    grid.appendChild(col);
  }
  const loose = members.filter(m => !placed.has(m.id));
  if (loose.length) {
    const col = h('div', { class: 'cat-team' }, h('div', { class: 'cat-team-name' }, 'Unassigned'));
    for (const m of loose) col.appendChild(memberRow(m, false));
    grid.appendChild(col);
  }
  if (canEdit && retired.length) {
    const col = h('div', { class: 'cat-team' }, h('div', { class: 'cat-team-name' }, 'Retired'));
    for (const m of retired) col.appendChild(memberRow(m, false));
    grid.appendChild(col);
  }
  card.appendChild(grid);
  root.appendChild(card);
}
