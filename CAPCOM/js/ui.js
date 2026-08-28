/* ui.js — shared widgets: toast, modal, confirm, field builders, empty state.
   The BRUCE set, trimmed to what the Control Room uses. */
import { h, clear } from './util.js';

let toastTimer = null;
export function toast(msg, kind = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'err' ? 6000 : 3000);
}

/* modal(title, bodyNode, actions[]) — actions: {label, kind, onClick(close)}.
   Returns close(). One at a time; Escape closes. */
export function modal(title, body, actions = []) {
  const old = document.getElementById('modal-back');
  if (old) old.remove();
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const back = h('div', { id: 'modal-back', onClick: e => { if (e.target === back) close(); } },
    h('div', { class: 'modal' },
      h('div', { class: 'modal-head' },
        h('h2', null, title),
        h('button', { class: 'x', onClick: close, 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-actions' },
        actions.map(a => h('button', {
          class: 'btn ' + (a.kind || ''),
          onClick: () => a.onClick(close),
        }, a.label))) : null));
  document.body.appendChild(back);
  document.addEventListener('keydown', onKey);
  const first = back.querySelector('input, textarea, select');
  if (first) first.focus();
  return close;
}

export function confirmBox(title, message, onYes, yesLabel = 'Yes, do it') {
  modal(title, h('p', { class: 'confirm-msg' }, message), [
    { label: 'Cancel', onClick: c => c() },
    { label: yesLabel, kind: 'danger', onClick: c => { c(); onYes(); } },
  ]);
}

/* Labeled form field. spec: {label, hint, input} */
export function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function textInput(props = {}) { return h('input', { type: 'text', ...props }); }
export function textArea(props = {}) { return h('textarea', { rows: 3, ...props }); }
export function select(options, props = {}) {
  return h('select', props, options.map(o =>
    h('option', { value: o.value, selected: o.selected ? 'selected' : null }, o.label)));
}

export function emptyState(msg, sub) {
  return h('div', { class: 'empty' }, h('p', null, msg), sub ? h('p', { class: 'sub' }, sub) : null);
}

export function chip(text, cls = '') { return h('span', { class: 'chip ' + cls }, text); }

export function sectionTitle(text, ...extras) {
  return h('div', { class: 'sec-title' }, h('h2', null, text), h('div', { class: 'sec-extras' }, extras));
}

export function spinner() { return h('div', { class: 'spin' }, 'Loading…'); }

export function errorState(err, retry) {
  return h('div', { class: 'empty err' },
    h('p', null, err && err.message ? err.message : 'Something failed'),
    err && err.detail ? h('p', { class: 'sub' }, String(err.detail)) : null,
    retry ? h('button', { class: 'btn', onClick: retry }, 'Try again') : null);
}
