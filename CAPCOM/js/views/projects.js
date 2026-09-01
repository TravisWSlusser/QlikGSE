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
  const wantNew = params && params[0] === 'new';
  if (wantNew) history.replaceState(null, '', '#projects');
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender, canEdit, wantNew && canEdit);
  return root;
}

async function load(root, rerender, canEdit, openNew) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender, canEdit))); return; }
  clear(root);

  const teamById = {}, statusById = {};
  for (const t of d.teams) teamById[t.id] = t;
  for (const s of d.statuses) statusById[s.id] = s;
  const activeTeams = d.teams.filter(t => t.active);
  const activeStatuses = d.statuses.filter(s => s.active);
  const activeProjects = d.projects.filter(p => p.active);
  const overdueCount = activeProjects.filter(p => p.overdue).length;
  const teamsShipping = new Set(activeProjects.map(p => p.team_id)).size;

  root.appendChild(h('div', { class: 'tiles' },
    statTile('Active projects', fmt.int(activeProjects.length)),
    statTile('Overdue', fmt.int(overdueCount), overdueCount ? 'phases past their promise' : 'all promises holding'),
    statTile('Teams shipping', fmt.int(teamsShipping)),
    statTile('Statuses in play', fmt.int(new Set(activeProjects.map(p => p.status_id)).size))));

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
      h('button', { class: 'btn sm', onClick: () => teamsDialog(d, rerender) }, 'Teams'),
      h('button', { class: 'btn sm', onClick: () => statusesDialog(d, rerender) }, 'Statuses'),
      h('button', { class: 'btn sm accent', onClick: () => editProject(null, d, rerender) }, '+ New project'),
    ] : [])));

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
      h('tbody', null, rows.map(p => projectRow(p, d, teamById, statusById, canEdit, rerender)))));
  };
  drawRows();

  if (openNew) editProject(null, d, rerender);
}

function statusChip(s) {
  if (!s) return chip('?', 'muted');
  return h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${s.color})` } }, s.label);
}

function projectRow(p, d, teamById, statusById, canEdit, rerender) {
  const team = teamById[p.team_id], st = statusById[p.status_id];
  return h('tr', { class: p.active ? null : 'prj-retired' },
    h('td', null,
      h('div', { class: 'prj-title' }, p.title),
      p.description ? h('div', { class: 'prj-desc' }, p.description) : null,
      (p.links || []).length ? h('div', { class: 'prj-links' }, p.links.map(l =>
        h('a', { class: 'prj-link', href: l.href, target: '_blank', rel: 'noopener' }, l.label + ' ↗'))) : null),
    h('td', null, h('span', { class: 'prj-people' }, p.people || '—')),
    h('td', null, team ? team.name : '?'),
    h('td', null, statusChip(st),
      h('div', { class: 'diary-meta', style: { marginTop: '3px' } }, `${p.days_in_phase}d in phase`)),
    h('td', { class: 'prj-due' },
      fmt.day(p.phase_due),
      p.overdue ? h('div', { style: { marginTop: '4px' } }, h('span', { class: 'overdue-badge' }, '⚠ OVERDUE')) : null),
    h('td', null, h('div', { class: 'prj-actions' },
      h('button', { class: 'btn xs', onClick: () => diaryDialog(p, d, canEdit, rerender) }, 'Diary'),
      ...(canEdit && p.active ? [
        h('button', { class: 'btn xs' + (p.overdue ? ' danger' : ''), onClick: () => statusDialog(p, d, rerender) }, 'Status'),
        h('button', { class: 'btn xs', onClick: () => extendDialog(p, rerender) }, p.overdue ? 'What happened' : 'Extend'),
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
  modal(isNew ? 'Post a project' : 'Edit project',
    h('div', { class: 'form' },
      field('Title', f.title),
      field('What is it?', f.description, 'The show-off line — what this is and why it matters.'),
      field('Who is on it', f.people),
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
function teamsDialog(d, rerender) {
  const rows = d.teams.filter(t => t.active).map(t => {
    const name = textInput({ value: t.name, maxLength: 40 });
    const sort = textInput({ value: String(t.sort), style: { width: '54px' } });
    return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      name, sort,
      h('button', { class: 'btn xs', onClick: async () => {
        try { await api.projectsAdmin({ op: 'saveTeam', id: t.id, name: name.value, sort: Number(sort.value) }); toast('Team saved'); rerender(); }
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
