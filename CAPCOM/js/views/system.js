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
  projects: 'Project tracker — post, status, milestones',
  system: 'Maintenance, keys, setup — full control',
};

export function render(params, rerender) {
  // '#system/newkey' (a Home quick action) opens the mint dialog on arrival.
  const wantNew = params && params[0] === 'newkey';
  if (wantNew) history.replaceState(null, '', '#system');
  const root = h('div', { class: 'view' });
  const keys = h('div', { class: 'card' }, spinner());
  const secrets = h('div', { class: 'card' }, spinner());
  root.append(keys, secrets, setupCard(rerender));
  loadKeys(keys, rerender, wantNew);
  loadSecrets(secrets, rerender);
  return root;
}

/* ── Access keys ── */
async function loadKeys(card, rerender, wantNew) {
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
  card.appendChild(h('p', { class: 'explain' },
    'Scoped keys for leaders and SMEs — an SME key with only “content” opens the question banks and nothing else. '
    + 'The master key lives in the Vercel env and is not listed here.'));

  if (wantNew) createKey(d.scopes || [], rerender);

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

/* ── Keys & Services ── */
async function loadSecrets(card, rerender) {
  let d;
  try { d = await api.secrets({ op: 'list' }); }
  catch (err) {
    clear(card);
    card.appendChild(sectionTitle('Keys & Services'));
    card.appendChild(err.status === 403
      ? h('p', { class: 'sub' }, 'Your key does not include the system scope.')
      : errorState(err, () => loadSecrets(card, rerender)));
    return;
  }
  clear(card);

  card.appendChild(sectionTitle('Keys & Services'));
  card.appendChild(h('p', { class: 'explain' },
    'The service keys the apps run on. Values set here take effect within a minute, no deploy — the Vercel '
    + 'env var stays as the fallback, so clearing a value here falls back to it. Full values are never shown '
    + 'back, only their masked form.'));
  if (!d.mailReady) {
    card.appendChild(h('p', { class: 'warn-note' },
      '⚠ Email notifications are off — add RESEND_API_KEY in the Vercel env (free account at resend.com) '
      + 'and changes will be mailed to the notification address below.'));
  }

  const srcChip = s => chip(s === 'app' ? 'set here' : s === 'env' ? 'from Vercel env' : 'not set',
    s === 'unset' ? 'pin' : 'muted');

  card.appendChild(h('div', { class: 'sec-list' }, (d.slots || []).map(s =>
    h('div', { class: 'sec-row' },
      h('div', { class: 'sec-main' },
        h('span', { class: 'sec-name mono' }, s.name, srcChip(s.src)),
        h('span', { class: 'sec-desc' }, s.desc),
        h('span', { class: 'sec-meta' }, 'Current: ', h('b', { class: 'mono' }, s.masked),
          s.at ? ` — updated ${s.at} by ${s.by || '?'}` : '')),
      h('button', { class: 'btn sm', onClick: () => editSecret(s, rerender) }, 'Update')))));

  card.appendChild(h('p', { class: 'field-hint' },
    'Env-only (never editable from here, by design — they are what the app boots from): '
    + (d.roots || []).map(r => `${r.name} (${r.src === 'env' ? 'set' : 'MISSING'})`).join(' · ')));
}

function editSecret(s, rerender) {
  const input = h('input', {
    type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: s.name === 'NOTIFY_EMAIL' ? 'name@qlik.com' : 'Paste the new value — leave empty to clear',
  });
  modal(`Update ${s.name}`,
    h('div', { class: 'form' },
      h('p', { class: 'sub' }, s.desc),
      field('New value', input,
        'Saving emails the notification address with the change. An empty value clears this row so the Vercel env var applies again.')),
    [
      { label: 'Cancel', onClick: c => c() },
      {
        label: 'Save & notify', kind: 'accent', onClick: async c => {
          try {
            const r = await api.secrets({ op: 'set', name: s.name, value: input.value });
            c();
            toast(r.notified ? `Saved — ${r.mailNote}` : `Saved. Email not sent: ${r.mailNote}`, r.notified ? 'ok' : 'err');
            rerender();
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
