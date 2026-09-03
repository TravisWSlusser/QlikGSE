/* projects.js — the Project Board: what every team is building, who is on
   it, what status it sits in, and WHEN that phase was promised to be done.

   The accountability mechanic in one breath: every status change declares
   a date; a date that slips flags the row OVERDUE; the server refuses the
   next move until someone writes down what happened. The UI here is a
   courtesy — lib/admin/projects.js is the enforcement.

   Reads are open to every key holder (visibility is the product); every
   write control renders only when the key carries the 'projects' scope. */
import { h, clear, fmt, esc } from '../util.js';
import { api } from '../api.js';
import {
  toast, modal, confirmBox, field, textInput, textArea, select,
  emptyState, chip, sectionTitle, spinner, errorState,
} from '../ui.js';
import { statTile } from '../charts.js';

const PALETTE = ['violet', 'teal', 'amber', 'rose', 'blue', 'orange', 'sky'];
const KIND_LABEL = {
  created: 'Posted', status_change: 'Status', overdue_note: 'Overdue log',
  due_change: 'Date moved', update: 'Update', milestone: 'Milestone',
};

export function render(params, rerender, who) {
  const canEdit = !!(who && who.scopes && who.scopes.includes('projects'));
  // registry rights (add/edit members, reset codes): managers + masters only
  const canManage = !!(who && (who.master || who.manager));
  const me = (who && who.member) || null; // member session: acts on tagged projects only
  const wantNew = params && params[0] === 'new';
  if (wantNew) history.replaceState(null, '', '#projects');
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, canEdit, wantNew && canEdit, me, canManage);
  return root;
}

async function load(root, rerender, canEdit, openNew, me, canManage) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, canEdit, false, me, canManage))); return; }
  d.canManage = !!canManage; // rides the bundle into the shared dialogs
  d.meId = me ? me.id : 0;   // the signed-in member, for self-service OOO
  d.recByTri = {};
  for (const r of d.recs || []) d.recByTri[(r.trigram || '').toUpperCase()] = r;
  clear(root);

  const teamById = {}, statusById = {};
  for (const t of d.teams) teamById[t.id] = t;
  for (const s of d.statuses) statusById[s.id] = s;
  // the member registry rides on d so every row and dialog can reach it
  d.memberById = {};
  for (const m of d.members || []) d.memberById[m.id] = m;
  d.tagsByProject = {};
  d.tagsByMember = {};
  for (const t of d.tags || []) {
    (d.tagsByProject[t.project_id] = d.tagsByProject[t.project_id] || []).push(t.member_id);
    (d.tagsByMember[t.member_id] = d.tagsByMember[t.member_id] || []).push(t.project_id);
  }
  const activeTeams = d.teams.filter(t => t.active);
  const activeStatuses = d.statuses.filter(s => s.active);
  const activeProjects = d.projects.filter(p => p.active);
  const overdueCount = activeProjects.filter(p => p.overdue).length;

  root.appendChild(h('div', { class: 'tiles' },
    statTile('Active projects', fmt.int(activeProjects.length)),
    statTile('Overdue', fmt.int(overdueCount), overdueCount ? 'phases past their promise' : 'all promises holding')));

  // filters are client-side; the list is small by construction
  const flt = { team: 0, status: 0, retired: false };
  const teamSel = select([{ value: '0', label: 'All teams' },
    ...activeTeams.map(t => ({ value: String(t.id), label: t.name }))]);
  const statusSel = select([{ value: '0', label: 'All statuses' },
    ...activeStatuses.map(s => ({ value: String(s.id), label: s.label }))]);
  const retiredCb = h('input', { type: 'checkbox' });
  teamSel.addEventListener('change', () => { flt.team = Number(teamSel.value); drawRows(); });
  statusSel.addEventListener('change', () => { flt.status = Number(statusSel.value); drawRows(); });
  retiredCb.addEventListener('change', () => { flt.retired = retiredCb.checked; drawRows(); });

  const card = h('div', { class: 'card' });
  card.appendChild(sectionTitle('Project Board',
    h('span', { class: 'prj-filters' },
      teamSel, statusSel,
      h('label', { class: 'prj-filters', style: { fontSize: '.78rem', color: 'var(--muted)' } }, retiredCb, 'retired')),
    ...(canEdit ? [
      h('a', { class: 'btn sm', href: '#projects/staff' }, 'Staff'),
      h('button', { class: 'btn sm', onClick: () => teamsDialog(d, rerender) }, 'Teams'),
      h('button', { class: 'btn sm', onClick: () => statusesDialog(d, rerender) }, 'Statuses'),
      h('button', { class: 'btn sm accent', onClick: () => editProject(null, d, rerender) }, '+ New project'),
    ] : [])));

  // an empty registry is invisible until you know where to look — say so
  if (canEdit && !(d.members || []).length) {
    card.appendChild(h('p', { class: 'sub prj-hint' },
      'No team members yet — the ',
      h('a', { href: '#projects/staff' }, 'Staff tab'),
      ' is where people get added (name + REC Room trigram). They must be in there before you can tag them on projects or they can claim member access at the gate.'));
  }

  const wrap = h('div', { class: 'table-wrap' });
  card.appendChild(wrap);
  root.appendChild(card);

  const drawRows = () => {
    clear(wrap);
    const rows = d.projects.filter(p =>
      (p.active || flt.retired) &&
      (!flt.team || p.team_id === flt.team) &&
      (!flt.status || p.status_id === flt.status));
    if (!rows.length) {
      wrap.appendChild(emptyState('Nothing on the board.',
        canEdit ? 'Post the first project — + New project above.' : 'Projects appear here as teams post them.'));
      return;
    }
    wrap.appendChild(h('table', null,
      h('thead', null, h('tr', null,
        ['Project', 'People', 'Team', 'Status', 'Phase due', ''].map(x => h('th', null, x)))),
      h('tbody', null, rows.map(p => projectRow(p, d, teamById, statusById, canEdit, me, rerender)))));
  };
  drawRows();

  if (openNew) editProject(null, d, rerender);
}

function statusChip(s) {
  if (!s) return chip('?', 'muted');
  return h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${s.color})` } }, s.label);
}

function projectRow(p, d, teamById, statusById, canEdit, me, rerender) {
  const team = teamById[p.team_id], st = statusById[p.status_id];
  // a member session can move only projects it is tagged on — mirrored
  // here for honest buttons; lib/admin/projects.js enforces it regardless
  const mine = !!(me && (d.tagsByProject[p.id] || []).includes(me.id));
  return h('tr', { class: p.active ? null : 'prj-retired' },
    h('td', null,
      h('div', { class: 'prj-title' }, p.title),
      p.description ? h('div', { class: 'prj-desc' }, p.description) : null,
      (p.links || []).length ? h('div', { class: 'prj-links' }, p.links.map(l =>
        h('a', { class: 'prj-link', href: l.href, target: '_blank', rel: 'noopener' }, l.label + ' ↗'))) : null),
    h('td', null,
      (() => {
        const memberIds = d.tagsByProject[p.id] || [];
        const chips = memberIds.map(id => d.memberById[id]).filter(Boolean).map(m =>
          h('button', { class: 'mem-chip', title: 'See what ' + m.name + ' has helped with', onClick: () => historyDialog(m, d) }, m.name));
        return h('div', null,
          chips.length ? h('div', { class: 'mem-chips' }, chips) : null,
          p.people ? h('span', { class: 'prj-people' }, p.people) : null,
          !chips.length && !p.people ? h('span', { class: 'prj-people' }, '—') : null);
      })()),
    h('td', null, team ? team.name : '?'),
    h('td', null, statusChip(st),
      h('div', { class: 'diary-meta', style: { marginTop: '3px' } }, `${p.days_in_phase}d in phase`)),
    h('td', { class: 'prj-due' },
      fmt.day(p.phase_due),
      p.overdue ? h('div', { style: { marginTop: '4px' } }, h('span', { class: 'overdue-badge' }, '⚠ OVERDUE')) : null),
    h('td', null, h('div', { class: 'prj-actions' },
      h('button', { class: 'btn xs', onClick: () => diaryDialog(p, d, canEdit || (mine && p.active), rerender) }, 'Diary'),
      ...((canEdit || mine) && p.active ? [
        h('button', { class: 'btn xs' + (p.overdue ? ' danger' : ''), onClick: () => statusDialog(p, d, rerender) }, 'Status'),
        h('button', { class: 'btn xs', onClick: () => extendDialog(p, rerender) }, p.overdue ? 'What happened' : 'Extend'),
      ] : []),
      ...(canEdit && p.active ? [
        h('button', { class: 'btn xs', onClick: () => editProject(p, d, rerender) }, 'Edit'),
        h('button', { class: 'btn xs', onClick: () => confirmBox('Retire this project?',
          `“${p.title}” comes off the board. Its diary stays, and it can be restored.`, async () => {
            try { await api.projects({ op: 'retire', id: p.id }); toast('Project retired'); rerender(); }
            catch (err) { toast(err.message, 'err'); }
          }, 'Retire') }, 'Retire'),
      ] : []),
      ...(canEdit && !p.active ? [
        h('button', { class: 'btn xs', onClick: async () => {
          try { await api.projects({ op: 'retire', id: p.id, restore: true }); toast('Project restored'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        } }, 'Restore'),
      ] : []))));
}

/* ── create / edit ── */
function editProject(p, d, rerender) {
  const isNew = !p;
  const activeTeams = d.teams.filter(t => t.active);
  const activeStatuses = d.statuses.filter(s => s.active);
  const f = {
    title: textInput({ value: p ? p.title : '', maxLength: 90 }),
    description: textArea({ value: p ? p.description : '', rows: 3, maxLength: 2000 }),
    people: textInput({ value: p ? p.people : '', maxLength: 300, placeholder: 'Names, comma-separated — free text' }),
    team: select(activeTeams.map(t => ({ value: String(t.id), label: t.name, selected: p && p.team_id === t.id }))),
    links: textArea({
      rows: 2, placeholder: 'One per line: Label | https://…',
      value: p ? (p.links || []).map(l => `${l.label} | ${l.href}`).join('\n') : '',
    }),
    status: isNew ? select(activeStatuses.map(s => ({ value: String(s.id), label: s.label }))) : null,
    due: isNew ? h('input', { type: 'date' }) : null,
  };
  // tagging registered members — live ops on an existing project; the
  // person-history cards are built from exactly these tags
  const tagBlock = !isNew ? (() => {
    const wrap = h('div', { class: 'mem-chips' });
    const drawChips = () => {
      clear(wrap);
      const ids = d.tagsByProject[p.id] || [];
      wrap.append(...ids.map(mid => d.memberById[mid]).filter(Boolean).map(m =>
        h('span', { class: 'mem-chip' }, m.name,
          h('button', { class: 'mem-chip-x', 'aria-label': 'Untag ' + m.name, onClick: async () => {
            try {
              await api.members({ op: 'untag', project_id: p.id, member_id: m.id });
              const arr = d.tagsByProject[p.id] || [];
              arr.splice(arr.indexOf(m.id), 1);
              toast(m.name + ' untagged');
              drawChips();
            } catch (err) { toast(err.message, 'err'); }
          } }, '✕'))));
      if (!ids.length) wrap.appendChild(h('span', { class: 'prj-people' }, 'Nobody tagged yet.'));
    };
    drawChips();
    const options = (d.members || []).filter(m => m.active);
    const sel = select([{ value: '0', label: options.length ? 'Tag a member…' : 'No members yet — add them via Members' },
      ...options.map(m => ({ value: String(m.id), label: m.name }))]);
    sel.addEventListener('change', async () => {
      const mid = Number(sel.value);
      sel.value = '0';
      if (!mid) return;
      try {
        await api.members({ op: 'tag', project_id: p.id, member_id: mid });
        (d.tagsByProject[p.id] = d.tagsByProject[p.id] || []).push(mid);
        toast(d.memberById[mid].name + ' tagged');
        drawChips();
      } catch (err) { toast(err.message, 'err'); }
    });
    return field('Team members on this', h('div', null, wrap, sel),
      'Tags build each person’s project history — changes apply immediately.');
  })() : null;

  modal(isNew ? 'Post a project' : 'Edit project',
    h('div', { class: 'form' },
      field('Title', f.title),
      field('What is it?', f.description, 'The show-off line — what this is and why it matters.'),
      tagBlock,
      field(isNew ? 'Who is on it' : 'Guests / externals (free text)', f.people,
        isNew ? 'Free text for now — after posting, tag registered members from Edit.' : null),
      field('Team', f.team),
      field('Links', f.links, 'Demo, doc, repo — Label | URL, one per line, up to 6.'),
      ...(isNew ? [
        field('Starting status', f.status),
        field('When will this phase be done?', f.due,
          'You are committing to a date — the board flags the project if it slips.'),
      ] : [])),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: isNew ? 'Post it' : 'Save', kind: 'accent', onClick: async c => {
        const links = f.links.value.split('\n').map(x => x.trim()).filter(Boolean).map(line => {
          const i = line.indexOf('|');
          return i >= 0
            ? { label: line.slice(0, i).trim(), href: line.slice(i + 1).trim() }
            : { label: '', href: line };
        });
        try {
          await api.projects({
            op: 'save', id: p ? p.id : undefined,
            title: f.title.value, description: f.description.value,
            people: f.people.value, team_id: Number(f.team.value), links,
            ...(isNew ? { status_id: Number(f.status.value), phase_due: f.due.value } : {}),
          });
          c(); toast(isNew ? 'Project posted' : 'Project saved'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* ── the accountability dialogs ── */
function statusDialog(p, d, rerender) {
  const options = d.statuses.filter(s => s.active && s.id !== p.status_id)
    .map(s => ({ value: String(s.id), label: s.label }));
  const st = select(options);
  const due = h('input', { type: 'date' });
  const note = textArea({ rows: 3, maxLength: 1000, placeholder: p.overdue
    ? 'Required — this project is overdue. What happened?'
    : 'Optional — anything worth putting in the diary?' });
  modal(`Change status — ${p.title}`,
    h('div', { class: 'form' },
      p.overdue ? h('p', { class: 'sub' },
        h('span', { class: 'overdue-badge' }, '⚠ OVERDUE'),
        ` This phase was promised for ${fmt.day(p.phase_due)}. The written log below is required.`) : null,
      field('New status', st),
      field('When will this phase be done?', due, 'A new phase, a new promise.'),
      field(p.overdue ? 'What happened' : 'Note', note)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Change it', kind: 'accent', onClick: async c => {
        try {
          await api.projects({ op: 'status', id: p.id, status_id: Number(st.value), phase_due: due.value, note: note.value });
          c(); toast('Status changed'); rerender();
        } catch (err) { toast(err.message, 'err'); } // 409s keep the dialog open — the server is the gate
      } },
    ]);
}

function extendDialog(p, rerender) {
  const due = h('input', { type: 'date' });
  const note = textArea({ rows: 3, maxLength: 1000, placeholder: p.overdue
    ? 'Required — the written log is the price of the extension.'
    : 'Optional — why is the date moving?' });
  modal(p.overdue ? `File what happened — ${p.title}` : `Move the phase date — ${p.title}`,
    h('div', { class: 'form' },
      p.overdue ? h('p', { class: 'sub' },
        h('span', { class: 'overdue-badge' }, '⚠ OVERDUE'),
        ` Promised for ${fmt.day(p.phase_due)} and still in the same phase. Say what happened, pick the new date.`) : null,
      field('New phase date', due),
      field(p.overdue ? 'What happened' : 'Note', note)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: p.overdue ? 'File it' : 'Move it', kind: 'accent', onClick: async c => {
        try {
          await api.projects({ op: 'extend', id: p.id, phase_due: due.value, note: note.value });
          c(); toast(p.overdue ? 'Logged — new date set' : 'Date moved'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* ── the diary ── */
async function diaryDialog(p, d, canEdit, rerender) {
  const statusById = {};
  for (const s of d.statuses) statusById[s.id] = s;
  let entries = [];
  try { entries = (await api.projects({ op: 'log', project_id: p.id })).entries; }
  catch (err) { toast(err.message, 'err'); return; }

  const rows = h('div', { class: 'diary-rows' },
    entries.length ? [...entries].reverse().map(e => {
      const from = e.from_status_id && statusById[e.from_status_id];
      const to = e.to_status_id && statusById[e.to_status_id];
      return h('div', { class: 'diary-row' },
        h('span', { class: 'diary-kind' + (e.kind === 'overdue_note' ? ' overdue' : '') }, KIND_LABEL[e.kind] || e.kind),
        e.kind === 'status_change' || e.kind === 'created' ? h('span', { style: { fontSize: '.82rem' } },
          from ? [h('span', { class: 'diary-dot', style: { background: `var(--ps-${from.color})` } }), from.label, ' → '] : null,
          to ? [h('span', { class: 'diary-dot', style: { background: `var(--ps-${to.color})` } }), to.label] : null) : null,
        e.phase_due ? h('span', { class: 'diary-meta' }, `  due ${fmt.day(e.phase_due)}`) : null,
        e.note ? h('div', { class: 'diary-note' }, e.note) : null,
        h('div', { class: 'diary-meta' }, `${e.actor} · ${fmt.when(e.created_at)}`));
    }) : emptyState('Nothing in the diary yet.'));

  const addNote = canEdit && p.active ? (() => {
    const inp = textInput({ placeholder: 'Add an update to the diary…', maxLength: 1000 });
    const go = async () => {
      if (!inp.value.trim()) return;
      try {
        await api.projects({ op: 'note', id: p.id, note: inp.value });
        toast('Update logged');
        inp.value = '';
        diaryDialog(p, d, canEdit, rerender); // reopen fresh
      } catch (err) { toast(err.message, 'err'); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'form', style: { marginBottom: '12px' } },
      h('div', { style: { display: 'flex', gap: '8px' } }, inp,
        h('button', { class: 'btn sm accent', onClick: go }, 'Log it')));
  })() : null;

  modal(`Diary — ${p.title}`,
    h('div', null, addNote, rows),
    [
      ...(canEdit && p.active ? [{ label: 'Pin milestone…', onClick: c => { c(); milestoneDialog(p, rerender); } }] : []),
      { label: 'Close', kind: 'accent', onClick: c => c() },
    ]);
}

function milestoneDialog(p, rerender) {
  const date = h('input', { type: 'date' });
  const title = textInput({ maxLength: 80, placeholder: 'Demo day, launch, review…' });
  const detail = textArea({ rows: 2, maxLength: 500 });
  modal(`Pin a milestone — ${p.title}`,
    h('div', { class: 'form' },
      field('Date', date, 'Past dates are fine — recording the demo that happened counts.'),
      field('Title', title),
      field('Detail (optional)', detail)),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Pin it', kind: 'accent', onClick: async c => {
        try {
          await api.projects({ op: 'saveMilestone', project_id: p.id, date: date.value, title: title.value, detail: detail.value });
          c(); toast('Milestone pinned'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* ── managed lists: the editCategories row pattern ── */
export function teamsDialog(d, rerender) {
  const activeMembers = (d.members || []).filter(m => m.active);
  const rows = d.teams.filter(t => t.active).map(t => {
    const name = textInput({ value: t.name, maxLength: 40 });
    const sort = textInput({ value: String(t.sort), style: { width: '54px' } });
    const leader = select([{ value: '0', label: '— leader —' },
      ...activeMembers.map(m => ({ value: String(m.id), label: m.name, selected: t.leader_id === m.id }))]);
    return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      name, sort, leader,
      h('button', { class: 'btn xs', onClick: async () => {
        try { await api.projectsAdmin({ op: 'saveTeam', id: t.id, name: name.value, sort: Number(sort.value), leader_id: Number(leader.value) || null }); toast('Team saved'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      } }, 'Save'),
      h('button', { class: 'btn xs danger', onClick: async () => {
        try { await api.projectsAdmin({ op: 'retireTeam', id: t.id }); toast('Team retired'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      } }, 'Retire'));
  });
  const newName = textInput({ maxLength: 40, placeholder: 'New team name' });
  modal('Teams',
    h('div', { class: 'form' }, ...rows,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, newName,
        h('button', { class: 'btn xs accent', onClick: async () => {
          try { await api.projectsAdmin({ op: 'saveTeam', name: newName.value }); toast('Team added'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        } }, 'Add'))),
    [{ label: 'Done', kind: 'accent', onClick: c => c() }]);
}

/* ── the member registry: a read-only list; right-click a row to act ── */
let pctxEl = null;
export function pctx(x, y, entries) {
  if (!pctxEl) {
    pctxEl = h('div', { id: 'pctx-menu' });
    document.body.appendChild(pctxEl);
    document.addEventListener('click', () => { if (pctxEl) pctxEl.style.display = 'none'; });
  }
  clear(pctxEl).append(...entries.map(([label, fn, danger]) =>
    h('button', { class: 'ctx-item' + (danger ? ' danger' : ''), onClick: () => { pctxEl.style.display = 'none'; fn(); } }, label)));
  pctxEl.style.display = 'block';
  pctxEl.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  pctxEl.style.top = Math.min(y, window.innerHeight - entries.length * 40 - 12) + 'px';
}

export function membersDialog(d, rerender) {
  const teamById = {};
  for (const t of d.teams) teamById[t.id] = t;
  const canManage = !!d.canManage; // registry writes: managers + masters
  const rows = (d.members || []).filter(m => m.active).map(m => {
    const menu = () => [
      ['Edit…', () => editMemberDialog(m, d, rerender), false],
      ['One-time invite…', () => inviteDialog(m), false],
      ...(m.claimed ? [['Reset access code', () => confirmBox('Reset this access code?',
        `${m.name}'s member sign-in stops working until they claim a new code at the gate.`, async () => {
          try { await api.members({ op: 'resetCode', id: m.id }); toast('Code reset'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Reset it'), false]] : []),
      ['Retire', () => confirmBox('Retire this member?',
        `${m.name} comes off the registry — their project history stays.`, async () => {
          try { await api.members({ op: 'retire', id: m.id }); toast('Member retired'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        }, 'Retire'), true],
    ];
    const row = h('div', { class: 'mem-row', title: canManage ? 'Right-click to edit' : undefined },
      h('span', { class: 'mem-row-name' }, m.name),
      m.trigram ? h('span', { class: 'mem-row-tri' }, m.trigram) : null,
      h('span', { class: 'mem-row-detail' },
        [m.title, (teamById[m.team_id] || {}).name, m.email].filter(Boolean).join(' · ') || '—'),
      h('span', { class: 'mem-row-claim' + (m.claimed ? ' on' : '') }, m.claimed ? 'claimed' : 'unclaimed'),
      canManage ? h('button', { class: 'itm-menu mem-row-menu', 'aria-label': 'Member menu', onClick: ev => {
        ev.stopPropagation();
        pctx(ev.clientX, ev.clientY, menu());
      } }, '⋯') : null);
    if (canManage) row.addEventListener('contextmenu', ev => { ev.preventDefault(); pctx(ev.clientX, ev.clientY, menu()); });
    return row;
  });
  modal('Team Member Catalog',
    h('div', null,
      h('div', { class: 'mem-cat-head' },
        canManage ? h('button', { class: 'btn sm accent', onClick: () => editMemberDialog(null, d, rerender) }, '+ Add New') : null,
        h('span', { class: 'sub' }, canManage
          ? 'Right-click a member to edit, reset their code, or retire them.'
          : 'Managers sign the team up and reset codes.')),
      rows.length ? h('div', { class: 'mem-cat' }, ...rows)
        : emptyState('Nobody in the registry yet.', 'Add New puts the first person in.')),
    [{ label: 'Done', kind: 'accent', onClick: c => c() }]);
}

/* Issue a ONE-TIME invite code — the only way anyone gets member
   access. Shown large, once, with a copy button; the manager sends it
   themselves. Works for first access AND as a password reset. */
export function inviteDialog(m) {
  (async () => {
    let r;
    try { r = await api.members({ op: 'invite', id: m.id }); }
    catch (err) { toast(err.message, 'err'); return; }
    const codeEl = h('div', { class: 'invite-code' }, r.code);
    modal(`One-time invite — ${m.name}`,
      h('div', null,
        codeEl,
        h('p', { class: 'sub' }, `Send this to ${m.name} yourself (Slack, email, out loud). At the CAPCOM gate they choose “First time? Set up your member access”, enter their trigram + this code, and create their own password.`),
        h('p', { class: 'sub' }, 'It works once and expires in 7 days. If they already had a password, the old one keeps working until they use this.')),
      [
        { label: 'Copy code', onClick: async () => {
          try { await navigator.clipboard.writeText(r.code); toast('Copied'); }
          catch { toast('Copy failed — select it by hand', 'err'); }
        } },
        { label: 'Done', kind: 'accent', onClick: c => c() },
      ]);
  })();
}

export function editMemberDialog(m, d, rerender) {
  const isNew = !m;
  const activeTeams = d.teams.filter(t => t.active);
  const name = textInput({ value: m ? m.name : '', maxLength: 60 });
  const tri = textInput({ value: m ? (m.trigram || '') : '', maxLength: 3, placeholder: 'TRI', style: { textTransform: 'uppercase' } });
  const title = textInput({ value: m ? (m.title || '') : '', maxLength: 60 });
  const email = textInput({ value: m ? (m.email || '') : '', maxLength: 120, placeholder: 'email@qlik.com' });
  const team = select([{ value: '0', label: '— no team —' },
    ...activeTeams.map(t => ({ value: String(t.id), label: t.name, selected: m && m.team_id === t.id }))]);
  const isLeader = h('input', { type: 'checkbox', checked: m && m.is_leader ? true : null });
  const isManager = h('input', { type: 'checkbox', checked: m && m.is_manager ? true : null });
  // the brand avatar — upload one of Travis's cartoon set (or any image)
  let avatarUrl = m ? (m.avatar_url || '') : '';
  const avPreview = h('img', { class: 'prof-avatar av-edit', alt: '', src: avatarUrl || undefined, hidden: avatarUrl ? null : true });
  const avFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  const avClear = h('button', { class: 'btn xs', hidden: avatarUrl ? null : true, onClick: e => {
    e.preventDefault(); avatarUrl = ''; avPreview.hidden = true; avClear.hidden = true;
  } }, 'Remove');
  avFile.addEventListener('change', () => {
    const file = avFile.files && avFile.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const b64 = String(rd.result).split(',')[1] || '';
        const r = await api.uploadImage({ name: file.name, type: file.type, data: b64 });
        avatarUrl = r.url;
        avPreview.src = r.url; avPreview.hidden = false; avClear.hidden = false;
        toast('Avatar uploaded — save the member to keep it');
      } catch (err) { toast(err.message, 'err'); }
    };
    rd.readAsDataURL(file);
  });
  const avatarRow = h('div', { class: 'av-row' }, avPreview, avFile, avClear);
  const leaders = (d.members || []).filter(x => x.active && x.is_leader && (!m || x.id !== m.id));
  const mgr = select([{ value: '0', label: leaders.length ? '— nobody —' : '— no people leaders declared yet —' },
    ...leaders.map(x => ({ value: String(x.id), label: x.name, selected: m && m.manager_id === x.id }))]);
  modal(isNew ? 'Add a team member' : `Edit — ${m.name}`,
    h('div', { class: 'form' },
      field('Full name', name),
      field('Trigram', tri, 'Their REC Room identity — three letters. Needed before they can claim member access.'),
      field('Role', title),
      field('Email', email),
      field('Team', team),
      field('Avatar', avatarRow, 'The brand cartoon for their profile and the Staff page.'),
      field('People leader', isLeader, 'Declared leaders can have staff report to them — enablement has several.'),
      field('Reports to', mgr, 'Their people leader. Staff sit below their leader on the Staff tab.'),
      field('Manager', isManager, 'Managers hold every scope when signed in, and they alone sign the team up, reset codes, and grant this.')),
    [
      { label: 'Cancel', onClick: c => c() },
      { label: isNew ? 'Add them' : 'Save', kind: 'accent', onClick: async c => {
        try {
          await api.members({ op: 'save', id: m ? m.id : undefined, name: name.value,
            trigram: tri.value, title: title.value, email: email.value, team_id: Number(team.value) || null,
            is_leader: isLeader.checked, is_manager: isManager.checked, manager_id: Number(mgr.value) || null,
            avatar_url: avatarUrl });
          c(); toast(isNew ? 'Member added' : 'Member saved'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      } },
    ]);
}

/* ── the person card: everything this member has helped with.
   Exported: the Insights catalog opens it too. ── */
export function historyDialog(m, d) {
  const statusById = {};
  for (const s of d.statuses) statusById[s.id] = s;
  const teamById = {};
  for (const t of d.teams) teamById[t.id] = t;
  const projIds = d.tagsByMember[m.id] || [];
  const projById = {};
  for (const p of d.projects) projById[p.id] = p;
  // the profile lists LATEST work first — most recently touched project
  // on top, active before retired
  const touched = p => new Date(p.updated_at || p.created_at || 0).getTime();
  const projs = projIds.map(id => projById[id]).filter(Boolean)
    .sort((a, z) => (z.active - a.active) || (touched(z) - touched(a)));
  const rec = m.trigram ? (d.recByTri || {})[m.trigram.toUpperCase()] : null;
  const acc = rec && Number(rec.attempted) > 0
    ? Math.round((Number(rec.correct) / Number(rec.attempted)) * 100) : null;
  const canOoo = !!(d.canManage || (d.meId && d.meId === m.id));
  const oooLine = h('p', { class: 'prof-ooo' + (m.ooo_note ? ' on' : '') },
    m.ooo_note ? `Out of office — ${m.ooo_note}` : (canOoo ? 'In office (no OOO note)' : ''));
  const setOoo = () => {
    const note = textInput({ maxLength: 140, value: m.ooo_note || '', placeholder: 'e.g. Out until Sep 15 — ping Barb for anything urgent' });
    modal(`Out of office — ${m.name}`,
      h('div', { class: 'form' }, field('Note', note, 'Shows on the profile and the Staff page. Leave empty to clear it.')),
      [
        { label: 'Cancel', onClick: c => c() },
        { label: 'Save', kind: 'accent', onClick: async c => {
          try {
            await api.members({ op: 'ooo', id: m.id, note: note.value });
            m.ooo_note = note.value.trim();
            oooLine.textContent = m.ooo_note ? `Out of office — ${m.ooo_note}` : 'In office (no OOO note)';
            oooLine.className = 'prof-ooo' + (m.ooo_note ? ' on' : '');
            c(); toast('Saved');
          } catch (err) { toast(err.message, 'err'); }
        } },
      ]);
  };
  modal(m.name,
    h('div', null,
      h('div', { class: 'prof-head' },
        m.avatar_url ? h('img', { class: 'prof-avatar', src: m.avatar_url, alt: '' })
          : h('span', { class: 'prof-avatar prof-avatar-blank' }, (m.name || '?').slice(0, 1)),
        h('div', null,
          h('p', { class: 'sub', style: { marginBottom: '4px' } },
            [m.is_leader ? 'People leader' : null, m.title,
              (teamById[m.team_id] || {}).name,
              m.manager_id && d.memberById && d.memberById[m.manager_id] ? `reports to ${d.memberById[m.manager_id].name}` : null,
              m.trigram ? `REC Room: ${m.trigram}` : null]
              .filter(Boolean).join(' · ') || 'Team member',
            m.email ? [' · ', h('a', { href: 'mailto:' + m.email }, m.email)] : null),
          h('div', { class: 'prof-ooo-row' }, oooLine,
            canOoo ? h('button', { class: 'btn xs', onClick: setOoo }, 'Set OOO') : null),
          h('div', { class: 'prof-ooo-row' },
            h('p', { class: 'prof-status' }, m.status_text ? `“${m.status_text}”` : (canOoo ? 'No status posted' : '')),
            canOoo ? h('button', { class: 'btn xs', onClick: () => {
              const st = textInput({ maxLength: 180, value: m.status_text || '', placeholder: 'A quote, a joke, what you’re into this week…' });
              modal(`Status — ${m.name}`,
                h('div', { class: 'form' }, field('Status', st,
                  'Informal, on the Staff board. Changing or clearing it deletes the old post AND its reactions — forever.')),
                [
                  { label: 'Cancel', onClick: c => c() },
                  { label: 'Post it', kind: 'accent', onClick: async c => {
                    try {
                      await api.members({ op: 'status', id: m.id, text: st.value });
                      m.status_text = st.value.trim();
                      c(); toast(m.status_text ? 'Posted' : 'Status cleared');
                    } catch (err) { toast(err.message, 'err'); }
                  } },
                ]);
            } }, m.status_text ? 'Change' : 'Post Status') : null))),
      rec ? h('div', { class: 'prof-rec' },
        h('span', { class: 'prof-rec-t' }, 'REC Room'),
        h('span', null, `${fmt.int(Number(rec.total_score))} lifetime pts`),
        h('span', null, `${fmt.int(Number(rec.games_played))} runs`),
        Number(rec.blitz_personal_high) > 0 ? h('span', null, `high ${fmt.int(Number(rec.blitz_personal_high))}`) : null,
        acc != null ? h('span', null, `${acc}% accuracy`) : null) : null,
      projs.length
        ? h('div', { class: 'prj-glance' }, projs.map(p => {
          const st = statusById[p.status_id];
          const when = String(p.updated_at || p.created_at || '').slice(0, 10);
          return h('div', { class: 'prof-row' + (p.active ? '' : ' prj-retired') },
            h('div', { class: 'prj-glance-row' },
              h('span', { class: 'prj-glance-title' }, p.title),
              st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
              p.active
                ? (p.overdue
                  ? h('span', { class: 'overdue-badge' }, 'OVERDUE')
                  : h('span', { class: 'prj-glance-team' }, `due ${fmt.day(p.phase_due)}`))
                : h('span', { class: 'prj-glance-team' }, 'retired')),
            h('div', { class: 'diary-meta' },
              [(teamById[p.team_id] || {}).name, when ? `last activity ${fmt.day(when)}` : null]
                .filter(Boolean).join(' · ')));
        }))
        : emptyState('Not tagged on any projects yet.'),
      h('p', { class: 'sub', style: { marginTop: '10px' } },
        `${projs.length} project${projs.length === 1 ? '' : 's'} · open each project's Diary for the full story`)),
    [{ label: 'Close', kind: 'accent', onClick: c => c() }]);
}

function statusesDialog(d, rerender) {
  const swatchRow = picked => {
    const wrap = h('span', { class: 'ps-swatches' });
    wrap.append(...PALETTE.map(c => {
      const s = h('button', {
        class: 'ps-swatch' + (picked.value === c ? ' on' : ''), title: c,
        style: { background: `var(--ps-${c})` },
        onClick: () => {
          picked.value = c;
          [...wrap.children].forEach(x => x.classList.remove('on'));
          s.classList.add('on');
        },
      });
      return s;
    }));
    return wrap;
  };
  const rows = d.statuses.filter(s => s.active).map(s => {
    const label = textInput({ value: s.label, maxLength: 30 });
    const sort = textInput({ value: String(s.sort), style: { width: '54px' } });
    const picked = { value: s.color };
    return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      label, sort, swatchRow(picked),
      h('button', { class: 'btn xs', onClick: async () => {
        try { await api.projectsAdmin({ op: 'saveStatus', id: s.id, label: label.value, color: picked.value, sort: Number(sort.value) }); toast('Status saved'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      } }, 'Save'),
      h('button', { class: 'btn xs danger', onClick: async () => {
        try { await api.projectsAdmin({ op: 'retireStatus', id: s.id }); toast('Status retired'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      } }, 'Retire'));
  });
  const newLabel = textInput({ maxLength: 30, placeholder: 'New status' });
  const newPicked = { value: PALETTE[0] };
  modal('Statuses',
    h('div', { class: 'form' },
      h('p', { class: 'sub' }, 'Sort orders the ladder — the Gantt and donuts follow it.'),
      ...rows,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        newLabel, swatchRow(newPicked),
        h('button', { class: 'btn xs accent', onClick: async () => {
          try { await api.projectsAdmin({ op: 'saveStatus', label: newLabel.value, color: newPicked.value, sort: 99 }); toast('Status added'); rerender(); }
          catch (err) { toast(err.message, 'err'); }
        } }, 'Add'))),
    [{ label: 'Done', kind: 'accent', onClick: c => c() }]);
}
