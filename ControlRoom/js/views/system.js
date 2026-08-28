/* system.js — access keys and setup. (The REC Room maintenance switch has
   its own view under the REC Room nav group.) Master/system scope
   territory: everything on this screen can affect everyone. */
import { h, clear, esc } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

const SCOPE_DESC = {
  calendar: 'Calendar events and categories',
  banners: 'Hero rotators and image upload',
  content: 'Question banks (all three games)',
  analytics: 'Dashboard and player data (read-only)',
  system: 'Maintenance, keys, setup — full control',
};

export function render(params, rerender) {
  const root = h('div', { class: 'view' });
  const keys = h('div', { class: 'card' }, spinner());
  root.append(keys, setupCard(rerender));
  loadKeys(keys, rerender);
  return root;
}

/* ── Access keys ── */
async function loadKeys(card, rerender) {
  let d;
  try { d = await api.keys({ op: 'list' }); }
  catch (err) {
    clear(card);
    card.appendChild(sectionTitle('Access keys'));
    card.appendChild(err.status === 403
      ? h('p', { class: 'sub' }, 'Your key does not include the system scope.')
      : errorState(err, () => loadKeys(card, rerender)));
    return;
  }
  clear(card);

  card.appendChild(sectionTitle('Access keys',
    h('button', { class: 'btn accent', onClick: () => createKey(d.scopes || [], rerender) }, '+ New key')));
  card.appendChild(h('p', { class: 'sub' },
    'Scoped keys for leaders and SMEs — an SME key with only “content” opens the question banks and nothing else. '
    + 'The master key lives in the Vercel env and is not listed here.'));

  const rows = d.keys || [];
  if (!rows.length) { card.appendChild(emptyState('No scoped keys yet.')); return; }
  card.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Key', 'Label', 'Scopes', 'Created', 'Last used', ''].map(x => h('th', null, x)))),
    h('tbody', null, rows.map(k => h('tr', k.active ? null : { class: 'retired' },
      h('td', { class: 'mono' }, k.key),
      h('td', null, k.label),
      h('td', null, (k.scopes || []).map(s => chip(s, s === 'system' ? 'pin' : 'muted'))),
      h('td', { class: 'sub' }, k.created_at),
      h('td', { class: 'sub' }, k.last_used || 'never'),
      h('td', null, k.active
        ? h('button', {
            class: 'btn sm danger', onClick: () =>
              confirmBox('Revoke this key?', `“${k.label}” stops working immediately. It can be restored later.`,
                async () => {
                  try { await api.keys({ op: 'revoke', key: k.key }); toast('Key revoked'); rerender(); }
                  catch (err) { toast(err.message, 'err'); }
                }, 'Revoke it'),
          }, 'Revoke')
        : h('button', {
            class: 'btn sm', onClick: async () => {
              try { await api.keys({ op: 'restore', key: k.key }); toast('Key restored'); rerender(); }
              catch (err) { toast(err.message, 'err'); }
            },
          }, 'Restore'))))))));
}

function createKey(scopes, rerender) {
  const label = textInput({ placeholder: 'Who or what this key is for — “Huw — calendar”, “SME question editors”…' });
  const boxes = {};
  const scopeList = h('div', { class: 'scope-list' }, scopes.map(s => {
    boxes[s] = h('input', { type: 'checkbox' });
    return h('label', { class: 'scope-row' }, boxes[s],
      h('span', null, h('b', null, s), h('i', null, SCOPE_DESC[s] || '')));
  }));
  modal('New access key',
    h('div', { class: 'form' }, field('Label', label), field('Scopes', scopeList)),
    [
      { label: 'Cancel', onClick: c => c() },
      {
        label: 'Create key', kind: 'accent', onClick: async c => {
          const chosen = Object.keys(boxes).filter(s => boxes[s].checked);
          try {
            const r = await api.keys({
              op: 'create', label: label.value, scopes: chosen,
              confirmSystem: chosen.includes('system') ? true : undefined,
            });
            c();
            // Shown exactly once — the list only ever shows a masked prefix.
            const keyBox = h('input', { type: 'text', value: r.key, readOnly: 'readonly', class: 'mono keyout', onClick: e => e.target.select() });
            modal('Key created — copy it now',
              h('div', { class: 'form' },
                h('p', { class: 'sub' }, 'This is the only time the full key is shown. Send it to the person it is for over a private channel.'),
                keyBox,
                h('button', {
                  class: 'btn', onClick: () => { keyBox.select(); document.execCommand('copy'); toast('Copied'); },
                }, 'Copy to clipboard')),
              [{ label: 'Done', onClick: cc => { cc(); rerender(); } }]);
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ]);
}

/* ── Setup ── */
function setupCard(rerender) {
  return h('div', { class: 'card' },
    sectionTitle('Setup'),
    h('p', { class: 'sub' },
      'Creates every table the Control Room needs and seeds the calendar and banners from what the pages ship today. '
      + 'Safe to run any number of times — it never touches content that already exists.'),
    h('button', {
      class: 'btn', onClick: async e => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Running…';
        try {
          const r = await api.migrate();
          toast('Setup complete: ' + (r.done || []).join(', '));
          rerender();
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = 'Run setup'; }
      },
    }, 'Run setup'));
}
