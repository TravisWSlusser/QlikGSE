/* system.js — maintenance switch, access keys, and setup. Master/system
   scope territory: everything on this screen can affect everyone. */
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
  const maint = h('div', { class: 'card' }, spinner());
  const keys = h('div', { class: 'card' }, spinner());
  root.append(maint, keys, setupCard(rerender));
  loadMaint(maint, rerender);
  loadKeys(keys, rerender);
  return root;
}

/* ── Maintenance ── */
async function loadMaint(card, rerender) {
  let m;
  try { m = await api.maintenanceGet(); }
  catch (err) { clear(card).appendChild(errorState(err, () => loadMaint(card, rerender))); return; }
  clear(card);

  card.appendChild(sectionTitle('REC Room maintenance',
    h('span', { class: 'status-dot ' + (m.on ? 'closed' : 'open') }, m.on ? 'CLOSED' : 'OPEN')));

  if (!m.tableExists) {
    card.appendChild(h('p', { class: 'warn-note' },
      '⚠ The app_state table does not exist yet, so the switch is inert (the room fails open). Run setup below first.'));
    return;
  }

  card.appendChild(h('p', { class: 'sub' },
    'Closing shows every player a full-screen BE RIGHT BACK, abandons runs in progress, and rejects score writes with a 503. '
    + 'Pages poll every 45 seconds, so allow up to a minute each way. It fails open on any error, by design.'));

  const msg = textInput({ value: m.message, placeholder: 'Back by 3pm ET — banking scores and shipping an update.' });
  const eta = textInput({ value: m.eta, placeholder: 'Back by 3pm ET', class: 'narrow' });
  card.appendChild(h('div', { class: 'form' },
    field('Message shown to players', msg),
    field('ETA line', eta)));

  card.appendChild(h('div', { class: 'btn-row' },
    m.on
      ? h('button', {
          class: 'btn accent', onClick: async () => {
            try { await api.maintenanceSet({ on: false }); toast('Room reopening — up to a minute to reach everyone'); rerender(); }
            catch (err) { toast(err.message, 'err'); }
          },
        }, 'Reopen the room')
      : h('button', {
          class: 'btn danger', onClick: () =>
            confirmBox('Close the REC Room?', 'Everyone currently playing loses their run. Score writes 503 until you reopen.',
              async () => {
                try {
                  await api.maintenanceSet({ on: true, message: msg.value, eta: eta.value });
                  toast('Room closing — up to a minute to reach everyone'); rerender();
                } catch (err) { toast(err.message, 'err'); }
              }, 'Close it'),
        }, 'Close the room'),
    h('button', {
      class: 'btn', onClick: async () => {
        try { await api.maintenanceSet({ on: m.on, message: msg.value, eta: eta.value }); toast('Message saved'); }
        catch (err) { toast(err.message, 'err'); }
      },
    }, 'Save message only')));
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
