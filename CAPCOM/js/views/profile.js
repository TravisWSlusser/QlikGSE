/* profile.js — a person's page.
 *
 * The MySpace angle, made real. CAPCOM already knew everything on this
 * page; it was scattered across a modal called historyDialog, a status
 * line on a staff card, and a REC Room table. One page, one person, one
 * link you can send.
 *
 * ROUTE: #profile           → whoever is signed in
 *        #profile/<id>      → that person
 * Not in the sidebar on purpose. You get here by clicking a face, which
 * is the whole point of putting faces everywhere; a nav entry would make
 * it a destination rather than a thing you fall into.
 *
 * scope: null. Everything here is already visible to every key holder on
 * the Staff page and the Board — this page rearranges it, it does not
 * widen it. The only WRITES are self-service (your picture, your status,
 * your OOO) plus reacting to anyone's post, all enforced in members.js.
 *
 * One /api/admin/projects call feeds it, the same bundle the Board and
 * Staff pages use, shaped by shapeProjects() so the three stay identical.
 */
import { h, clear, fmt } from '../util.js';
import { api } from '../api.js';
import {
  spinner, errorState, sectionTitle, chip, emptyState, toast,
  modal, field, textInput,
} from '../ui.js';
import { avatar, avatarEditor, clearAvatar } from '../avatar.js';
import { giphyGrid } from '../giphy.js';
import { shapeProjects, pctx } from './projects.js';

const REACT_SET = ['👍', '🎉', '🔥', '😂', '💚', '👏'];

export function render(params, rerender, who) {
  const root = h('div', { class: 'view' }, spinner());
  load(root, params, rerender, who);
  return root;
}

async function load(root, params, rerender, who) {
  let d;
  try { d = await api.projects({ op: 'list', all: true }); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, params, rerender, who))); return; }
  shapeProjects(d, who);

  const meId = d.meId;
  const wantId = Number(params && params[0]) || meId;
  const m = d.memberById[wantId];
  clear(root);

  if (!m) {
    root.appendChild(h('div', { class: 'card' }, emptyState(
      wantId ? 'No profile for that person.' : 'You are signed in with a key, not a staff account.',
      wantId
        ? 'They may have been retired from the staff registry.'
        : 'Profiles belong to staff members. Open Staff to find someone.')));
    return;
  }

  const self = meId && meId === m.id;
  const canManage = !!d.canManage;
  const redraw = () => load(root, params, rerender, who);

  root.appendChild(headerCard(m, d, { self, canManage, redraw }));
  root.appendChild(statusCard(m, d, { self, canManage, redraw }));

  const grid = h('div', { class: 'grid2' });
  root.appendChild(grid);
  grid.appendChild(projectsCard(m, d));
  grid.appendChild(recCard(m, d));
}

/* ── the header: face, name, where they sit ── */
function headerCard(m, d, ctx) {
  const team = (d.teamById[m.team_id] || {}).name;
  const boss = m.manager_id && d.memberById[m.manager_id];
  const reports = (d.members || []).filter(x => x.manager_id === m.id && x.active);

  const face = ctx.self
    ? avatarEditor(m, 'xl', () => ctx.redraw())
    : avatar(m, { size: 'xl', link: false });

  const facts = [
    m.title,
    m.is_leader ? 'People leader' : null,
    m.is_manager ? 'Manager' : null,
    team,
  ].filter(Boolean);

  return h('div', { class: 'card prof-card' },
    h('div', { class: 'prof-hero' },
      face,
      h('div', { class: 'prof-hero-id' },
        h('h1', { class: 'prof-name' }, m.name,
          m.active ? null : chip('retired', 'muted')),
        h('p', { class: 'prof-facts' }, facts.join(' · ') || 'Team member'),
        h('div', { class: 'prof-meta' },
          m.trigram ? h('span', { class: 'prof-tri mono' }, m.trigram) : null,
          m.email ? h('a', { href: 'mailto:' + m.email }, m.email) : null,
          boss ? h('span', { class: 'prof-boss' }, 'reports to ',
            h('button', { class: 'lnk', onClick: () => { location.hash = '#profile/' + boss.id; } }, boss.name)) : null),
        reports.length
          ? h('div', { class: 'prof-reports' },
            h('span', { class: 'sub' }, reports.length === 1 ? 'Direct report' : `${reports.length} direct reports`),
            h('span', { class: 'av-stack' }, reports.map(r => avatar(r, { size: 'sm' }))))
          : null,
        ooOLine(m, d, ctx)),
      ctx.self && m.avatar_url
        ? h('button', { class: 'btn xs prof-av-clear', onClick: () => clearAvatar(m, () => ctx.redraw()) }, 'Remove picture')
        : (ctx.canManage && !ctx.self && m.avatar_url
          ? h('button', { class: 'btn xs prof-av-clear', onClick: () => clearAvatar(m, () => ctx.redraw()) }, 'Clear picture')
          : null)));
}

function ooOLine(m, d, ctx) {
  const canSet = ctx.self || ctx.canManage;
  const line = h('p', { class: 'prof-ooo' + (m.ooo_note ? ' on' : '') },
    m.ooo_note ? `Out of office — ${m.ooo_note}` : (canSet ? 'In office (no OOO note)' : ''));
  if (!canSet) return m.ooo_note ? line : null;
  return h('div', { class: 'prof-ooo-row' }, line,
    h('button', {
      class: 'btn xs',
      onClick: () => {
        const note = textInput({ maxLength: 140, value: m.ooo_note || '', placeholder: 'e.g. Out until Sep 15 — ping Barb for anything urgent' });
        modal(`Out of office — ${m.name}`,
          h('div', { class: 'form' }, field('Note', note, 'Shows here and on the Staff page. Leave empty to clear it.')),
          [{ label: 'Cancel', onClick: c => c() },
            { label: 'Save', kind: 'accent', onClick: async c => {
              try {
                await api.members({ op: 'ooo', id: m.id, note: note.value });
                c(); toast('Saved'); ctx.redraw();
              } catch (err) { toast(err.message, 'err'); }
            } }]);
      },
    }, m.ooo_note ? 'Change OOO' : 'Set OOO'));
}

/* ── the status wall: the post, and what people threw at it ── */
function statusCard(m, d, ctx) {
  const canPost = ctx.self || ctx.canManage;
  const reacts = (d.staffReacts || []).filter(r => r.member_id === m.id);

  const post = async (body) => {
    try { await api.members({ op: 'statusReact', id: m.id, ...body }); ctx.redraw(); }
    catch (err) { toast(err.message, 'err'); }
  };

  const card = h('div', { class: 'card' },
    sectionTitle(ctx.self ? 'Your status' : 'Status',
      m.status_at ? h('span', { class: 'sec-sub' }, fmt.when(m.status_at)) : null));

  if (!m.status_text) {
    card.appendChild(canPost
      ? h('div', { class: 'prof-noquote' },
        h('p', { class: 'explain' },
          ctx.self
            ? 'Nothing posted. A quote, a joke, what you’re into this week — it shows on your card across CAPCOM and people can react to it.'
            : 'Nothing posted.'),
        ctx.self ? h('button', { class: 'btn accent', onClick: () => editStatus(m, ctx) }, 'Post a status') : null)
      : emptyState('Nothing posted.'));
    return card;
  }

  // emoji grouped, stickers shown whole — a sticker IS the reaction
  const emojis = {};
  for (const r of reacts) if (r.emoji) (emojis[r.emoji] = emojis[r.emoji] || []).push(r.name);
  const stickers = reacts.filter(r => r.sticker_url);

  card.appendChild(h('blockquote', { class: 'prof-quote' }, m.status_text));
  card.appendChild(h('div', { class: 'prof-reacts' },
    ...Object.entries(emojis).map(([e, names]) =>
      h('span', { class: 'cat-react', title: names.join(', ') },
        `${e}${names.length > 1 ? ' ' + names.length : ''}`)),
    ...stickers.map(r => h('img', { class: 'prof-sticker', src: r.sticker_url, alt: '', title: r.name, loading: 'lazy' })),
    h('button', {
      class: 'cat-react cat-react-add',
      title: 'React with an emoji',
      onClick: ev => pctx(ev.clientX, ev.clientY, REACT_SET.map(e => [e, () => post({ emoji: e }), false])),
    }, '+'),
    h('button', { class: 'btn xs', onClick: () => stickerReact(m, post) }, 'Sticker / meme'),
    canPost ? h('button', { class: 'btn xs', onClick: () => editStatus(m, ctx) }, 'Change') : null));
  if (canPost) {
    card.appendChild(h('p', { class: 'explain prof-warn' },
      'Changing or clearing a status deletes the old post AND every reaction to it — permanently.'));
  }
  return card;
}

function stickerReact(m, post) {
  let picked = '';
  modal(`React to ${m.name}`,
    giphyGrid(url => { picked = url; }),
    [{ label: 'Cancel', onClick: c => c() },
      { label: 'Stick it on', kind: 'accent', onClick: async c => {
        if (!picked) { toast('Pick one first', 'err'); return; }
        c(); await post({ sticker_url: picked });
      } }]);
}

function editStatus(m, ctx) {
  const st = textInput({ maxLength: 180, value: m.status_text || '', placeholder: 'A quote, a joke, what you’re into this week…' });
  modal(`Status — ${m.name}`,
    h('div', { class: 'form' }, field('Status', st,
      'Informal, and it travels with you across CAPCOM. Changing or clearing it deletes the old post AND its reactions — forever.')),
    [{ label: 'Cancel', onClick: c => c() },
      { label: 'Post it', kind: 'accent', onClick: async c => {
        try {
          await api.members({ op: 'status', id: m.id, text: st.value });
          c(); toast(st.value.trim() ? 'Posted' : 'Status cleared'); ctx.redraw();
        } catch (err) { toast(err.message, 'err'); }
      } }]);
}

/* ── what they are working on — latest touched first, active before retired ── */
function projectsCard(m, d) {
  const touched = p => new Date(p.updated_at || p.created_at || 0).getTime();
  const projs = (d.tagsByMember[m.id] || [])
    .map(id => d.projectById[id]).filter(Boolean)
    .sort((a, z) => (z.active - a.active) || (touched(z) - touched(a)));

  const card = h('div', { class: 'card' },
    sectionTitle('Projects', h('span', { class: 'sec-sub' },
      projs.length ? `${fmt.int(projs.filter(p => p.active).length)} active` : '')));
  if (!projs.length) {
    card.appendChild(emptyState('Not tagged on anything yet.',
      'People get tagged from a project on the Project Board.'));
    return card;
  }
  card.appendChild(h('div', { class: 'prj-glance' }, projs.map(p => {
    const st = d.statusById[p.status_id];
    return h('div', { class: 'prof-row' + (p.active ? '' : ' prj-retired') },
      h('div', { class: 'prj-glance-row' },
        h('button', { class: 'prj-glance-title lnk', onClick: () => { location.hash = '#projects'; } }, p.title),
        st ? h('span', { class: 'prj-status-chip', style: { '--psc': `var(--ps-${st.color})` } }, st.label) : null,
        p.active ? null : chip('retired', 'muted')),
      // the others on it — faces, because this is a chip context
      h('span', { class: 'av-stack' },
        (d.tagsByProject[p.id] || []).filter(id => id !== m.id)
          .map(id => d.memberById[id]).filter(Boolean).slice(0, 6)
          .map(x => avatar(x, { size: 'xs' }))));
  })));
  return card;
}

/* ── the arcade record ── */
function recCard(m, d) {
  const rec = m.trigram ? d.recByTri[m.trigram.toUpperCase()] : null;
  const card = h('div', { class: 'card' },
    sectionTitle('REC Room', m.trigram ? h('span', { class: 'sec-sub mono' }, m.trigram) : null));
  if (!rec) {
    card.appendChild(emptyState(
      m.trigram ? 'No runs recorded yet.' : 'No trigram on this profile.',
      m.trigram ? 'Scores land here the first time they play.' : 'A trigram links a profile to the arcade.'));
    return card;
  }
  const acc = Number(rec.attempted) > 0
    ? Math.round((Number(rec.correct) / Number(rec.attempted)) * 100) : null;
  card.appendChild(h('div', { class: 'prof-rec-grid' },
    recStat('Lifetime points', fmt.int(Number(rec.total_score))),
    recStat('Runs', fmt.int(Number(rec.games_played))),
    recStat('Best run', Number(rec.blitz_personal_high) > 0 ? fmt.int(Number(rec.blitz_personal_high)) : '—'),
    recStat('Accuracy', acc != null ? acc + '%' : '—')));
  card.appendChild(h('button', { class: 'btn sm', onClick: () => { location.hash = '#dashboard'; } },
    'See the whole board →'));
  return card;
}

const recStat = (label, value) => h('div', { class: 'prof-rec-stat' },
  h('b', null, value), h('span', null, label));
