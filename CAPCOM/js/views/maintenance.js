/* maintenance.js — the machine room: the REC Room's BE RIGHT BACK
   switch, the service keys the apps run on (Keys & Services), and the
   Setup button. System scope throughout. Key GENERATION for outside
   people lives on Tailored Access under Projects — this page is the
   backend, that one is the front desk. */
import { h, clear } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, spinner, errorState, sectionTitle, chip } from '../ui.js';

export function render(params, rerender) {
  const root = h('div', { class: 'view' });
  const card = h('div', { class: 'card' }, spinner());
  const secrets = h('div', { class: 'card' }, spinner());
  root.append(card, secrets, setupCard(rerender));
  load(card, rerender);
  loadSecrets(secrets, rerender);
  return root;
}

async function load(card, rerender) {
  let m;
  try { m = await api.maintenanceGet(); }
  catch (err) { clear(card).appendChild(errorState(err, () => load(card, rerender))); return; }
  clear(card);

  card.appendChild(sectionTitle('REC Room maintenance',
    h('span', { class: 'status-dot ' + (m.on ? 'closed' : 'open') }, m.on ? 'CLOSED' : 'OPEN')));

  if (!m.tableExists) {
    card.appendChild(h('p', { class: 'warn-note' },
      '⚠ The app_state table does not exist yet, so the switch is inert (the room fails open). Run Setup below first.'));
    return;
  }

  card.appendChild(h('p', { class: 'explain' },
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
