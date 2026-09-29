/* avatar.js — the face behind the name.
 *
 * CAPCOM identified people by typed strings: a trigram on a scoreboard, a
 * name on a sticky note, an actor label in the change feed. That works and
 * reads like a database. Travis wanted the MySpace angle — so wherever a
 * person appears, they appear as a person.
 *
 * WHERE THE NAME GOES (the rule, decided once so it is consistent):
 *   - a CHIP (board note, reaction, project owner) shows the avatar ALONE,
 *     name on hover. These are tags; a name would crowd them out.
 *   - PROSE (a change-log sentence) shows avatar AND name. "🧑 retired a
 *     question" cannot be scanned for a person without hovering, and the
 *     change feed's whole job is being scannable.
 * Both go through avatar()/avatarName() here so the rule cannot drift.
 *
 * THE DEFAULT IS A PERSON ICON, not an initial. An initial looks like a
 * missing image; a person icon looks like a person who has not picked a
 * picture yet, which is what it is.
 *
 * UPLOADS ARE DOWNSCALED IN THE BROWSER, and that is not an optimisation:
 *   - it puts every avatar at 256x256 WebP, ~20KB, so the store stays
 *     trivial (the whole 891-person roster would be ~22MB);
 *   - it keeps every request far under Vercel's ~4.5MB cap, so a photo
 *     straight off a phone works instead of erroring;
 *   - it makes everything SQUARE, so the oval crop can never cut someone's
 *     head off at an unexpected aspect ratio.
 */
import { h, clear } from './util.js';
import { api } from './api.js';
import { toast } from './ui.js';

const SIZE = 256;          // stored edge, px
const QUALITY = 0.86;

/* A person, not a letter. Inline so it inherits currentColor and needs no
   round trip — this renders on every row of every list. */
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<circle cx="12" cy="8.2" r="3.9"/>'
  + '<path d="M3.8 21c0-4.2 3.7-6.6 8.2-6.6s8.2 2.4 8.2 6.6z"/></svg>';

/* One floating tooltip for every avatar on the page — the same pattern
   pop.js uses for player cards. A tooltip per avatar would be hundreds of
   detached nodes on the Staff page alone. */
let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = h('div', { id: 'av-tip' }); document.body.appendChild(tipEl); }
  return tipEl;
}
/* h() skips a null child; Element.append() renders the WORD "null".
   Everything built here is appended through a filter for that reason. */
export function put(el, ...kids) {
  kids.flat().filter(k => k != null && k !== false).forEach(k => el.appendChild(k));
  return el;
}

function showTip(anchor, m) {
  const e = clear(tip());
  put(e, h('b', null, m.name || 'Unknown'),
    m.title ? h('span', null, m.title) : null,
    m.trigram ? h('i', null, m.trigram) : null);
  e.style.display = 'flex';
  const r = anchor.getBoundingClientRect();
  const w = e.offsetWidth, hgt = e.offsetHeight;
  // flip above when there is no room below, and never run off the right edge
  const top = r.bottom + 8 + hgt > window.innerHeight ? r.top - hgt - 8 : r.bottom + 8;
  e.style.top = Math.max(6, top) + 'px';
  e.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

/* avatar(member, {size, link}) → the oval.
   `size` is a CSS length token: 'xs' | 'sm' | 'md' | 'lg' | 'xl'.
   `link` false suppresses the click-through (used inside a link already). */
export function avatar(m, { size = 'sm', link = true } = {}) {
  const who = m || {};
  const cls = 'av av-' + size + (who.avatar_url ? '' : ' av-blank');
  const el = who.avatar_url
    ? h('img', { class: cls, src: who.avatar_url, alt: who.name || '', loading: 'lazy' })
    : h('span', { class: cls, html: PERSON, role: 'img', 'aria-label': who.name || 'No picture' });
  if (who.name) {
    el.addEventListener('mouseenter', () => showTip(el, who));
    el.addEventListener('mouseleave', hideTip);
  }
  if (link && who.id) {
    el.classList.add('av-link');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const go = () => { hideTip(); location.hash = '#profile/' + who.id; };
    el.addEventListener('click', ev => { ev.stopPropagation(); go(); });
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
  }
  return el;
}

/* avatarName(member, opts) → avatar + name, for PROSE. */
export function avatarName(m, opts = {}) {
  const who = m || {};
  return h('span', { class: 'av-row' }, avatar(who, { size: 'xs', ...opts }),
    h('span', { class: 'av-nm' }, who.name || who.actor || 'Unknown'));
}

/* Resize to a centre-cropped square and re-encode. Returns {type, data}
   base64, or null when the file is not a readable image. */
function shrink(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // centre crop to a square first — scaling a 16:9 photo into a circle
      // squashes the face, and every one of these renders as a circle
      const edge = Math.min(img.width, img.height);
      const sx = (img.width - edge) / 2, sy = (img.height - edge) / 2;
      const cv = document.createElement('canvas');
      cv.width = cv.height = SIZE;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, edge, edge, 0, 0, SIZE, SIZE);
      // WebP everywhere it exists; Safari < 14 falls back and toDataURL
      // silently hands back a PNG, so read the type off the result rather
      // than assuming what was asked for
      const out = cv.toDataURL('image/webp', QUALITY);
      const type = out.slice(5, out.indexOf(';'));
      resolve({ type, data: out.slice(out.indexOf(',') + 1) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/* The picker. Opens the file dialog, shrinks, uploads, saves, and hands
   back the new URL ('' when cleared). Everything user-visible is a toast:
   this runs from a hover button with no room for an error panel. */
export function pickAvatar(member, onDone) {
  const input = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
  });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    toast('Resizing…');
    const small = await shrink(file);
    if (!small) { toast('That file is not an image CAPCOM can read', 'err'); return; }
    try {
      const up = await api.uploadAvatar({ name: 'avatar', type: small.type, data: small.data });
      await api.members({ op: 'avatar', id: member.id, avatar_url: up.url });
      toast('Picture updated');
      if (onDone) onDone(up.url);
    } catch (err) { toast(err.message, 'err'); }
  });
  input.click();
}

export async function clearAvatar(member, onDone) {
  try {
    await api.members({ op: 'avatar', id: member.id, avatar_url: '' });
    toast('Picture removed');
    if (onDone) onDone('');
  } catch (err) { toast(err.message, 'err'); }
}

/* avatarEditor(member, onChange) → the avatar with a hover affordance.
   Only ever rendered for the signed-in person, on their own row. */
export function avatarEditor(member, size, onChange) {
  const wrap = h('div', { class: 'av-edit-wrap' });
  const paint = () => {
    clear(wrap).append(
      avatar(member, { size, link: false }),
      h('button', {
        class: 'av-edit-btn',
        title: member.avatar_url ? 'Change your picture' : 'Add a picture',
      },
        h('span', { class: 'av-edit-ic', html: CAMERA }),
        h('span', { class: 'av-edit-tx' }, 'Update Avatar')));
  };
  paint();
  wrap.addEventListener('click', ev => {
    if (!ev.target.closest('.av-edit-btn')) return;
    ev.preventDefault(); ev.stopPropagation();
    pickAvatar(member, url => { member.avatar_url = url; paint(); if (onChange) onChange(url); });
  });
  return wrap;
}

const CAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M9 4.5h6l1.2 2H20a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V8A1.5 1.5 0 0 1 4 6.5h3.8z"/>'
  + '<circle cx="12" cy="12.6" r="3.6"/></svg>';
