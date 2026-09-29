/* projectPage.js — one project, start to finish.
 *
 * Travis: "Perhaps make it so each project gets its own little sub page
 * that folks can click and view the history, status, and outcome."
 *
 * The material existed; it was behind two modal doors. Status lived on a
 * board row, the diary behind a Diary button inside it, and the people on
 * it behind a chip. You could not send anyone a link to a project, and
 * reading its story meant opening a dialog on top of a dialog.
 *
 * ROUTE: #project/<id>. nav:false — you arrive by clicking a project's
 * name, the same way #profile works for a person.
 *
 * scope: null, matching the Project Board. Visibility is the product;
 * every WRITE on this page (a diary note) gates on 'projects' or on being
 * tagged to it, exactly as the board's own dialogs do.
 *
 * Two calls: the shared bundle for the project, its people and statuses,
 * and the diary for this one id.
 */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import {
  spinner, errorState, sectionTitle, chip, emptyState, toast, textInput,
} from '../ui.js';
import { avatar } from '../avatar.js';
import { shapeProjects } from './projects.js';

/* Class prefix is prp-, not pp-: pop.js owns .pp-* for the player
   stat card, and a second meaning for the same prefix is how two
   unrelated components start restyling each other. */

const KIND_LABEL = {
  created: 'Posted', status_change: 'Status', overdue_note: 'Overdue log',
  due_change: 'Date moved', update: 'Update', milestone: 'Milestone',
};

export function render(params, rerender, who) {
  const root = h('div', { class: 'view' }, spinner());
  load(root, params, who);
  return root;
}

async function load(root, params, who) {
  const id = Number(params && params[0]);
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, params, who))); return; }
  shapeProjects(d, who);
  const p = d.projectById[id];
  clear(root);

  if (!p) {
    root.appendChild(h('div', { class: 'card' }, emptyState(
      'No project with that id.',
      'It may have been deleted. The Project Board has everything current.')));
    root.appendChild(h('a', { class: 'btn', href: '#projects' }, '← Back to the board'));
    return;
  }

  const st = d.statusById[p.status_id];
  const people = (d.tagsByProject[p.id] || []).map(m => d.memberById[m]).filter(Boolean);
  const mine = people.some(m => m.id === d.meId);
  const canWrite = !!(who && who.scopes && who.scopes.includes('projects')) || (mine && p.active);

  // ── header ──
  root.appendChild(h('div', { class: 'card pp-head' },
    h('div', { class: 'prp-top' },
      h('a', { class: 'btn xs', href: '#projects' }, '← Board'),
      p.active ? null : chip('retired', 'muted')),
    h('h1', { class: 'prp-title' }, p.title),
    h('div', { class: 'prp-facts' },
      st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
      p.overdue ? h('span', { class: 'overdue-badge' }, 'OVERDUE') : null,
      p.phase_due ? h('span', null, `Due ${fmt.day(p.phase_due)}`) : null,
      p.days_in_phase != null ? h('span', null, `${p.days_in_phase}d in this phase`) : null,
      h('span', null, `Posted ${fmt.day(String(p.created_at || '').slice(0, 10))}`)),
    // the people, as faces — a project is a person-level thing now, and a
    // row of names crowded the title off the line
    people.length
      ? h('div', { class: 'prp-people' },
        h('span', { class: 'prp-lbl' }, people.length === 1 ? 'On it' : `On it · ${people.length}`),
        h('span', { class: 'av-stack' }, people.map(m => avatar(m, { size: 'sm' }))))
      : h('p', { class: 'sub' }, 'Nobody is tagged on this yet — tag people from the Project Board.')));

  // ── outcome / where it stands ──
  const outcome = h('div', { class: 'card' });
  outcome.appendChild(sectionTitle('Where it stands'));
  outcome.appendChild(h('div', { class: 'prp-stand' },
    stand('Status', st ? st.label : '—'),
    stand('Phase due', p.phase_due ? fmt.day(p.phase_due) : '—'),
    stand('Days in phase', p.days_in_phase != null ? String(p.days_in_phase) : '—'),
    stand('State', p.active ? (p.overdue ? 'Overdue' : 'On track') : 'Retired')));
  const miles = (d.milestones || []).filter(m => m.project_id === p.id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (miles.length) {
    outcome.appendChild(h('p', { class: 'prp-lbl' }, 'Milestones'));
    outcome.appendChild(h('div', { class: 'prp-miles' }, miles.map(m => {
      const done = String(m.date) <= new Date().toISOString().slice(0, 10);
      return h('div', { class: 'prp-mile' + (done ? ' done' : '') },
        h('span', { class: 'prp-mile-d' }, fmt.day(m.date)),
        h('span', { class: 'prp-mile-t' }, m.title,
          m.detail ? h('span', { class: 'sub' }, ' — ' + m.detail) : null),
        h('span', { class: 'prp-mile-s' }, done ? 'hit' : 'ahead'));
    })));
  }
  root.appendChild(outcome);

  // ── history ──
  const hist = h('div', { class: 'card' }, spinner());
  root.appendChild(hist);
  loadDiary(hist, p, d, canWrite, () => load(root, params, who));
}

const stand = (label, value) => h('div', { class: 'prp-stand-cell' },
  h('span', null, label), h('b', null, value));

/* The diary, newest first. This is the project's story and the reason the
   page exists — everything above it is a snapshot, this is the record. */
async function loadDiary(card, p, d, canWrite, reload) {
  let entries = [];
  try { entries = (await api.projects({ op: 'log', project_id: p.id })).entries || []; }
  catch (err) { clear(card).appendChild(errorState(err, () => loadDiary(card, p, d, canWrite, reload))); return; }
  clear(card);
  card.appendChild(sectionTitle('History',
    h('span', { class: 'sec-sub' }, entries.length
      ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
      : 'nothing recorded yet')));

  if (canWrite && p.active) {
    const inp = textInput({ placeholder: 'Add an update to the diary…', maxLength: 1000 });
    const go = async () => {
      if (!inp.value.trim()) return;
      try {
        await api.projects({ op: 'note', project_id: p.id, note: inp.value.trim() });
        toast('Added'); reload();
      } catch (err) { toast(err.message, 'err'); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    card.appendChild(h('div', { class: 'prp-add' }, inp,
      h('button', { class: 'btn accent', onClick: go }, 'Add')));
  }

  if (!entries.length) {
    card.appendChild(emptyState('Nothing in the diary yet.',
      'Status moves, date changes and notes all land here automatically.'));
    return;
  }

  card.appendChild(h('div', { class: 'diary-rows' }, [...entries].reverse().map(e => {
    const from = e.from_status_id && d.statusById[e.from_status_id];
    const to = e.to_status_id && d.statusById[e.to_status_id];
    // the actor is a typed string; match it to a face where we can
    const who = d.memberByName[String(e.actor || '').trim().toLowerCase()];
    return h('div', { class: 'diary-row' },
      h('span', { class: 'diary-kind' + (e.kind === 'overdue_note' ? ' overdue' : '') },
        KIND_LABEL[e.kind] || e.kind),
      e.kind === 'status_change' || e.kind === 'created'
        ? h('span', { style: { fontSize: '.82rem' } },
          from ? [h('span', { class: 'diary-dot', style: { background: `var(--ps-${from.color})` } }), from.label, ' → '] : null,
          to ? [h('span', { class: 'diary-dot', style: { background: `var(--ps-${to.color})` } }), to.label] : null)
        : null,
      e.phase_due ? h('span', { class: 'diary-meta' }, `  due ${fmt.day(e.phase_due)}`) : null,
      e.note ? h('div', { class: 'diary-note' }, e.note) : null,
      h('div', { class: 'diary-meta diary-by' },
        who ? avatar(who, { size: 'xs' }) : null,
        h('span', null, `${e.actor} · ${fmt.when(e.created_at)}`)));
  })));
}
