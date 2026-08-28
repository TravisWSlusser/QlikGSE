/* maintenance.js — the REC Room's BE RIGHT BACK switch, as its own view
   under the REC Room group (it closes the *room*, so it lives with the
   room). System scope: a 503 on every score write is not an SME power. */
import { h, clear } from '../util.js';
import { api } from '../api.js';
import { toast, confirmBox, field, textInput, spinner, errorState, sectionTitle } from '../ui.js';

export function render(params, rerender) {
  const root = h('div', { class: 'view' });
  const card = h('div', { class: 'card' }, spinner());
  root.appendChild(card);
  load(card, rerender);
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
      '⚠ The app_state table does not exist yet, so the switch is inert (the room fails open). Run Setup under Access & Setup first.'));
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
