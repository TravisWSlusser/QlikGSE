/* calendar.js — CRUD over the events table that feeds the Mission Control
   key-date chips and the month calendar. What saves here is live on the
   pages within about a minute (60s edge cache on /api/command/events). */
import { h, clear, fmt, isPast, esc } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, textArea, select, spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

export function render(params, rerender) {
  const root = h('div', { class: 'view' }, spinner());
  // '#calendar/new' (a Home quick action) lands here with the editor open.
  // The hash is rewritten back to '#calendar' so closing or saving the
  // dialog doesn't re-open it on the next redraw.
  const wantNew = params && params[0] === 'new';
  if (wantNew) history.replaceState(null, '', '#calendar');
  load(root, rerender, wantNew);
  return root;
}

async function load(root, rerender, wantNew) {
  let d;
  try { d = await api.listEvents(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, rerender))); return; }
  clear(root);

  const cats = {};
  for (const c of d.categories || []) cats[c.key] = c;
  const events = d.events || [];
  const pins = events.filter(e => e.pin && e.active).length;

  root.appendChild(calendarPreview(events.filter(e => e.active), cats));

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

  if (wantNew) editEvent(null, cats, rerender);
}

/* ── the Mission Control calendar widget, recreated — month grid, upcoming
   list, and the revolving event SPOTLIGHT with its pulsing eyebrow. The
   spotlighted event's day cell glows in its category color, same as the
   page. Rotates every 8s through upcoming events; past ones never feature
   (the Spotlight is a recommendation, not a record). ── */
function calendarPreview(events, cats) {
  const byDate = {};
  for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);
  const upcoming = events.filter(e => !isPast(e.date));
  const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const head = h('div', { class: 'mc-head' });
  const gridEl = h('div', { class: 'mc-grid' });
  const spot = h('div', { class: 'cp-spot' });

  let view = new Date(); view.setDate(1);
  let cellByIso = {};
  let lit = null, litIso = null;
  let si = 0, dayCycle = 0;
  let pinnedUntil = 0; // a clicked date holds the Spotlight; rotation resumes after

  const light = iso => {
    if (lit) { lit.classList.remove('mc-spotlit'); lit.style.removeProperty('--spot'); lit = null; }
    litIso = iso;
    const cell = iso && cellByIso[iso];
    if (cell) {
      const e = (byDate[iso] || [])[0];
      const color = e ? ((cats[e.category] || {}).color || '#10CFC9') : '#10CFC9';
      cell.classList.add('mc-spotlit');
      cell.style.setProperty('--spot', color);
      lit = cell;
    }
  };

  const feature = (e, extraCount) => {
    const color = (cats[e.category] || {}).color || '#10CFC9';
    // NB: native append() stringifies null into a literal "null" on the page
    // (unlike h(), which skips it) — hence the filter. Seen live.
    clear(spot).append(...[
      h('div', { class: 'cp-eyebrow' }, h('i', { class: 'cp-pulse', style: { background: color } }), 'SPOTLIGHT'),
      h('div', { class: 'cp-cat' }, h('i', { class: 'cp-cdot', style: { background: color } }),
        (cats[e.category] || {}).label || e.category),
      h('div', { class: 'cp-date' }, fmt.day(e.date), isPast(e.date) ? ' — past' : ''),
      h('div', { class: 'cp-title' }, e.title),
      h('div', { class: 'cp-detail' }, e.detail),
      extraCount ? h('div', { class: 'cp-more' }, `+${extraCount} more this day — click the date again`) : null,
    ].filter(Boolean));
    light(e.date);
  };

  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    clear(head).append(
      h('button', { class: 'btn xs', 'aria-label': 'Previous month', onClick: () => { view = new Date(y, m - 1, 1); draw(); } }, '‹'),
      h('span', { class: 'cp-month' }, `${MONTHS_LONG[m]} ${y}`),
      h('button', { class: 'btn xs', 'aria-label': 'Next month', onClick: () => { view = new Date(y, m + 1, 1); draw(); } }, '›'));

    clear(gridEl);
    cellByIso = {};
    for (const wd of ['S','M','T','W','T','F','S']) gridEl.appendChild(h('span', { class: 'mc-wd' }, wd));
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < first; i++) gridEl.appendChild(h('span'));
    for (let day = 1; day <= days; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const evs = byDate[iso] || [];
      const cell = h('span', {
        class: 'mc-day' + (evs.length ? ' has' : '')
          + (+new Date(y, m, day) === +today ? ' today' : '') + (isPast(iso) ? ' past' : ''),
        title: evs.map(e => e.title).join(' · ') || null,
      }, String(day),
        evs.length ? h('span', { class: 'mc-dots' }, evs.slice(0, 3).map(e =>
          h('i', { style: { background: (cats[e.category] || {}).color || 'var(--muted)' } }))) : null);
      if (evs.length) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          // clicking the same date again cycles through that day's events
          dayCycle = litIso === iso ? dayCycle + 1 : 0;
          const e = evs[dayCycle % evs.length];
          feature(e, evs.length - 1);
          pinnedUntil = Date.now() + 25_000; // hold before rotation resumes
        });
      }
      cellByIso[iso] = cell;
      gridEl.appendChild(cell);
    }
    // re-glow the featured date if it lives in this month
    light(litIso);
  };
  draw();

  const listEl = h('div', { class: 'mc-list' },
    upcoming.slice(0, 3).map(e => {
      const row = h('div', {
        class: 'mc-up', style: { '--evc': (cats[e.category] || {}).color || 'var(--muted)', cursor: 'pointer' },
      },
        h('span', { class: 'mc-up-date' }, fmt.day(e.date)),
        h('span', { class: 'mc-up-title' }, e.title));
      row.addEventListener('click', () => { feature(e, 0); pinnedUntil = Date.now() + 25_000; });
      return row;
    }));

  // ── rotation ──
  if (upcoming.length) {
    feature(upcoming[0], 0);
    si = 1;
    if (upcoming.length > 1) {
      const timer = setInterval(() => {
        if (!spot.isConnected) { clearInterval(timer); return; }
        if (Date.now() < pinnedUntil) return; // a clicked date holds the stage
        feature(upcoming[si % upcoming.length], 0);
        si++;
      }, 8000);
    }
  } else {
    spot.appendChild(h('p', { class: 'sub' }, 'Nothing upcoming to spotlight.'));
  }

  return h('div', { class: 'pv card' },
    h('div', { class: 'pv-tag' }, 'LIVE PREVIEW — the calendar widget as Mission Control shows it. Page months, click a date for its info.'),
    h('div', { class: 'pv-frame cp-frame' },
      h('div', { class: 'cp-cols' },
        h('div', null, head, gridEl, listEl),
        spot)));
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
