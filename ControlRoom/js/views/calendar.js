/* calendar.js — CRUD over the events table that feeds the Mission Control
   key-date chips and the month calendar. What saves here is live on the
   pages within about a minute (60s edge cache on /api/command/events). */
import { h, clear, fmt, isPast, esc } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, textArea, select, spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

export function render(params, rerender) {
  const root = h('div', { class: 'view' }, spinner());
  load(root, rerender);
  return root;
}

async function load(root, rerender) {
  let d;
  try { d = await api.listEvents(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender))); return; }
  clear(root);

  const cats = {};
  for (const c of d.categories || []) cats[c.key] = c;
  const events = d.events || [];
  const pins = events.filter(e => e.pin && e.active).length;

  root.appendChild(sectionTitle('Calendar',
    h('button', { class: 'btn accent', onClick: () => editEvent(null, cats, rerender) }, '+ New event'),
    h('button', { class: 'btn', onClick: () => editCategories(d.categories || [], rerender) }, 'Categories')));

  if (pins > 1) root.appendChild(h('p', { class: 'warn-note' },
    `⚠ ${pins} pinned events. There are only three chip slots on the homepage — every pin permanently claims one `
    + 'and stays after its date passes. One pin is the practical maximum.'));

  const upcoming = events.filter(e => e.active && !isPast(e.date));
  const past = events.filter(e => e.active && isPast(e.date));
  const retired = events.filter(e => !e.active);

  const section = (title, list, mutedNote) => {
    if (!list.length) return null;
    return h('div', { class: 'card' },
      sectionTitle(title),
      mutedNote ? h('p', { class: 'sub' }, mutedNote) : null,
      h('div', { class: 'ev-list' }, list.map(e => evRow(e, cats, rerender))));
  };

  root.appendChild(section('Upcoming', upcoming) || emptyState('No upcoming events.', 'Add one — the homepage chips fill from here.'));
  root.appendChild(section('Past', past, 'Dimmed on the pages, excluded from the Spotlight.') || h('span'));
  root.appendChild(section('Retired', retired, 'Off the public feed entirely. Restore from the edit dialog.') || h('span'));
}

function evRow(e, cats, rerender) {
  const cat = cats[e.category] || { label: e.category, color: '#888' };
  return h('div', { class: 'ev-row' + (e.active ? '' : ' retired') + (isPast(e.date) ? ' past' : '') },
    h('span', { class: 'ev-date', style: { '--evc': cat.color } }, fmt.day(e.date), h('i', null, e.date.slice(0, 4))),
    h('div', { class: 'ev-main' },
      h('div', { class: 'ev-title' }, e.title,
        e.pin ? chip('pinned', 'pin') : null,
        e.link ? chip('link', 'muted') : null,
        e.full_copy ? chip('long copy', 'muted') : null),
      h('div', { class: 'ev-detail' }, e.detail)),
    h('span', { class: 'ev-cat', style: { '--evc': cat.color } }, cat.label),
    h('button', { class: 'btn sm', onClick: () => editEvent(e, cats, rerender) }, 'Edit'),
    e.active
      ? h('button', {
          class: 'btn sm danger', onClick: () =>
            confirmBox('Retire this event?', `“${e.title}” comes off the homepage chips and the calendar. Nothing is deleted — you can restore it later.`,
              async () => {
                try { await api.deleteEvent(e.id); toast('Event retired'); rerender(); }
                catch (err) { toast(err.message, 'err'); }
              }, 'Retire it'),
        }, 'Retire')
      : null);
}

function editEvent(e, cats, rerender) {
  const isNew = !e;
  e = e || { date: '', category: 'event', title: '', detail: '', full_copy: '', link: '', pin: false, active: true };
  const f = {
    date: textInput({ value: e.date, placeholder: 'YYYY-MM-DD', maxLength: 10 }),
    category: select(Object.keys(cats).map(k => ({ value: k, label: cats[k].label, selected: k === e.category }))),
    title: textInput({ value: e.title, maxLength: 80, placeholder: 'Short — the homepage chip has limited width' }),
    detail: textArea({ value: e.detail, rows: 3, maxLength: 600 }),
    full_copy: textArea({ value: e.full_copy, rows: 5, maxLength: 5000 }),
    link: textInput({ value: e.link, maxLength: 500, placeholder: 'https://…' }),
    pin: h('input', { type: 'checkbox', checked: e.pin ? 'checked' : null }),
    active: h('input', { type: 'checkbox', checked: e.active ? 'checked' : null }),
  };

  modal(isNew ? 'New event' : 'Edit event',
    h('div', { class: 'form' },
      field('Date', f.date, 'Include the timezone in the detail text if you give a time — the org spans NAM to APAC.'),
      field('Category', f.category),
      field('Title', f.title, 'Up to 80 characters.'),
      field('Detail', f.detail, 'One or two sentences, up to 600 characters — shows when someone expands the chip or clicks the event on the calendar.'),
      field('Long-form copy (optional)', f.full_copy, 'Stored for the future long-form view. Not shown anywhere yet.'),
      field('Link (optional)', f.link, 'Shown as a clickable link on the pop-up card that opens from the calendar — e.g. the session’s Zoom link.'),
      h('div', { class: 'check-row' },
        h('label', null, f.pin, ' Pin to a chip slot'),
        h('label', null, f.active, ' Active')),
      h('p', { class: 'field-hint' },
        'Pinning claims one of only three homepage chip slots and keeps it after the date passes. Use it for must-not-miss deadlines only.')),
    [
      { label: 'Cancel', onClick: c => c() },
      {
        label: isNew ? 'Create' : 'Save', kind: 'accent', onClick: async c => {
          try {
            await api.saveEvent({
              id: e.id, date: f.date.value.trim(), category: f.category.value,
              title: f.title.value.trim(), detail: f.detail.value,
              full_copy: f.full_copy.value, link: f.link.value.trim(),
              pin: f.pin.checked, active: f.active.checked,
            });
            c(); toast(isNew ? 'Event created' : 'Event saved'); rerender();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ]);
}

function editCategories(categories, rerender) {
  const list = h('div', { class: 'form' });
  const row = (c) => {
    const key = textInput({ value: c ? c.key : '', placeholder: 'key', disabled: c ? 'disabled' : null, class: 'narrow' });
    const label = textInput({ value: c ? c.label : '', placeholder: 'Label' });
    const color = h('input', { type: 'color', value: c ? c.color : '#10CFC9' });
    const save = h('button', {
      class: 'btn sm accent', onClick: async () => {
        try {
          await api.saveCategory({ key: key.value.trim(), label: label.value.trim(), color: color.value });
          toast('Category saved'); rerender();
        } catch (err) { toast(err.message, 'err'); }
      },
    }, 'Save');
    return h('div', { class: 'cat-row' }, key, label, color, save);
  };
  categories.forEach(c => list.appendChild(row(c)));
  list.appendChild(h('p', { class: 'field-hint' }, 'Keys are permanent — events reference them. Add a new key for a new kind of date.'));
  list.appendChild(row(null));
  modal('Event categories', list, [{ label: 'Done', onClick: c => c() }]);
}
