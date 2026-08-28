/* banners.js — the hero rotators: Mission Control HIGHLIGHTS and the
   Stellar-Seller widget. Edits are live on the pages within about a minute.

   The two boards render differently and the editor says so:
   - highlights shows kicker/title/date/body, up to 4 CTA links, and an
     optional image (a small circle, hidden on mobile — decoration only).
   - stellar shows kicker/title/body and nothing else.
   Titles accept <span class="ac">word</span> for the green accent — the
   server strips every other tag on save. */
import { h, clear, esc } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, textArea, spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

/* One board per screen — the nav lists Hero Banners and Stellar-Seller as
   separate Mission Control entries, both landing here with the board as a
   route param. */
const BOARDS = {
  highlights: ['Hero Banners', 'The rotating HIGHLIGHTS on the Mission Control homepage — kicker, title, body, links, optional image.'],
  stellar: ['Stellar-Seller', 'The rotating posts in the Stellar-Seller hero widget. Text only — kicker, title, body.'],
};

export function render(params, rerender) {
  const board = BOARDS[params && params[0]] ? params[0] : 'highlights';
  // '#banners/<board>/new' (a Home quick action) opens the editor on arrival.
  const wantNew = params && params[1] === 'new';
  if (wantNew) history.replaceState(null, '', '#banners/' + board);
  const root = h('div', { class: 'view' }, spinner());
  load(root, board, rerender, wantNew);
  return root;
}

async function load(root, board, rerender, wantNew) {
  let d;
  try { d = await api.listBanners(); }
  catch (err) { clear(root).appendChild(errorState(err, () => load(root, board, rerender))); return; }
  clear(root);

  const [title, sub] = BOARDS[board];
  const rows = (d.banners || []).filter(b => b.board === board);
  const active = rows.filter(b => b.active);
  root.appendChild(h('div', { class: 'card' },
    sectionTitle(title,
      h('button', { class: 'btn accent', onClick: () => editBanner(null, board, rerender) }, '+ New post')),
    h('p', { class: 'sub' }, sub, ` ${active.length} live.`),
    rows.length
      ? h('div', { class: 'bn-list' }, rows.map((b, i) => bnRow(b, rows, i, rerender)))
      : emptyState('Nothing here yet.', 'The page is showing its built-in fallback copy until a post goes live.')));

  if (wantNew) editBanner(null, board, rerender);
}

function bnRow(b, rows, i, rerender) {
  return h('div', { class: 'bn-row' + (b.active ? '' : ' retired') },
    h('div', { class: 'bn-order' },
      h('button', { class: 'btn xs', disabled: i === 0 ? 'disabled' : null, onClick: () => move(b, rows, i, -1, rerender), 'aria-label': 'Move up' }, '▲'),
      h('button', { class: 'btn xs', disabled: i === rows.length - 1 ? 'disabled' : null, onClick: () => move(b, rows, i, 1, rerender), 'aria-label': 'Move down' }, '▼')),
    b.image_url ? h('img', { class: 'bn-thumb', src: b.image_url, alt: '' }) : null,
    h('div', { class: 'bn-main' },
      h('div', { class: 'bn-kicker' }, b.kicker || '—', b.active ? null : chip('retired', 'muted')),
      /* server-sanitised on save; innerHTML here is how the accent span previews */
      h('div', { class: 'bn-title', html: b.title }),
      h('div', { class: 'bn-body', html: b.body }),
      (Array.isArray(b.ctas) && b.ctas.length)
        ? h('div', { class: 'bn-ctas' }, b.ctas.map(c => chip(c.label + ' ↗', 'cta'))) : null),
    h('div', { class: 'bn-btns' },
      h('button', { class: 'btn sm', onClick: () => editBanner(b, b.board, rerender) }, 'Edit'),
      b.active
        ? h('button', {
            class: 'btn sm danger', onClick: () =>
              confirmBox('Retire this post?', 'It leaves the rotation. If it is the last one on the board, the server will refuse — the page would fall back to old hardcoded copy.',
                async () => {
                  try { await api.deleteBanner(b.id); toast('Post retired'); rerender(); }
                  catch (err) { toast(err.message, 'err'); }
                }, 'Retire it'),
          }, 'Retire')
        : h('button', {
            class: 'btn sm', onClick: async () => {
              try { await api.saveBanner({ ...b, active: true }); toast('Post restored'); rerender(); }
              catch (err) { toast(err.message, 'err'); }
            },
          }, 'Restore')));
}

async function move(b, rows, i, dir, rerender) {
  const other = rows[i + dir];
  if (!other) return;
  try {
    // swap sort values; two writes, order-safe because sort ties break on id
    await api.saveBanner({ ...b, sort: other.sort === b.sort ? other.sort + dir : other.sort });
    await api.saveBanner({ ...other, sort: b.sort });
    rerender();
  } catch (err) { toast(err.message, 'err'); }
}

/* Editors write PLAIN TEXT. The pages store the accent word as an HTML span,
   but nobody should have to read markup in a form field — so the editor
   round-trips it through a friendly convention: the green word is wrapped in
   *asterisks*. toFriendly() also decodes entities (&mdash; → —) so stored
   copy reads like copy. */
function toFriendly(html) {
  let s = String(html || '').replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '*$1*');
  // textarea innerHTML decodes entities without treating anything as markup
  const ta = document.createElement('textarea');
  ta.innerHTML = s.replace(/</g, '&lt;');
  return ta.value.replace(/&lt;/g, '<');
}
function toHtml(friendly) {
  return String(friendly || '').replace(/\*([^*\n]+)\*/g, '<span class="ac">$1</span>');
}

/* Server limits, mirrored here so the counter and maxLength agree with the
   rejection the API would send. Title gets +8 headroom for the asterisks. */
const LIMITS = { kicker: 40, title: 60, body: 300, date_text: 40 };

function counter(input, cap) {
  const c = h('span', { class: 'char-count' });
  const paint = () => {
    const n = input.value.replace(/\*/g, '').length;
    c.textContent = `${n}/${cap}`;
    c.classList.toggle('over', n > cap);
  };
  input.addEventListener('input', paint); paint();
  return c;
}

function editBanner(b, board, rerender) {
  const isNew = !b;
  const isStellar = board === 'stellar';
  b = b || { kicker: '', title: '', body: '', date_text: '', ctas: [], image_url: '', sort: 99, active: true };

  const f = {
    kicker: textInput({ value: toFriendly(b.kicker), maxLength: LIMITS.kicker }),
    title: textInput({ value: toFriendly(b.title), maxLength: LIMITS.title + 8, placeholder: 'Built to *Win*. — asterisks mark the green word' }),
    body: textArea({ value: toFriendly(b.body), rows: 3, maxLength: LIMITS.body }),
    date_text: textInput({ value: b.date_text, maxLength: LIMITS.date_text, placeholder: 'August 14, 2026 — shows as “Added …”' }),
    image_url: textInput({ value: b.image_url, placeholder: 'https://… or upload below' }),
  };

  // live preview under the title box — shows the accent exactly as the page will
  const preview = h('div', { class: 'bn-preview' });
  const paint = () => { preview.innerHTML = toHtml(f.title.value) || '<span class="dim">title preview</span>'; };
  f.title.addEventListener('input', paint); paint();

  // CTA editor — up to 4 {label, href}
  const ctaList = h('div', { class: 'cta-list' });
  const ctaRow = (c) => {
    const label = textInput({ value: c ? c.label : '', placeholder: 'Label', class: 'narrow', maxLength: 40 });
    const href = textInput({ value: c ? c.href : '', placeholder: 'https://…' });
    const del = h('button', { class: 'btn xs danger', onClick: () => row.remove(), 'aria-label': 'Remove link' }, '✕');
    const row = h('div', { class: 'cta-row' }, label, href, del);
    row._get = () => ({ label: label.value.trim(), href: href.value.trim() });
    return row;
  };
  (Array.isArray(b.ctas) ? b.ctas : []).forEach(c => ctaList.appendChild(ctaRow(c)));
  const addCta = h('button', {
    class: 'btn sm', onClick: () => { if (ctaList.children.length < 4) ctaList.appendChild(ctaRow(null)); },
  }, '+ Link');

  // image upload → Vercel Blob → url into the field
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
  const upBtn = h('button', {
    class: 'btn sm', onClick: () => {
      const file = fileIn.files && fileIn.files[0];
      if (!file) { toast('Choose a file first', 'err'); return; }
      // Client-side pre-checks mirror the server caps (1.5MB, 50–2000px per
      // side) so the common mistakes fail instantly, before any upload.
      if (file.size > 1.5 * 1024 * 1024) {
        toast(`That file is ${(file.size / 1048576).toFixed(1)}MB — the cap is 1.5MB. It renders at most 190px wide, so export smaller.`, 'err');
        return;
      }
      upBtn.disabled = true; upBtn.textContent = 'Uploading…';
      const done = () => { upBtn.disabled = false; upBtn.textContent = 'Upload'; };
      const objUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        if (img.naturalWidth > 2000 || img.naturalHeight > 2000) {
          toast(`That image is ${img.naturalWidth}×${img.naturalHeight}px — the cap is 2000px on either side.`, 'err');
          done(); return;
        }
        if (img.naturalWidth < 50 || img.naturalHeight < 50) {
          toast('That image is under 50px — too small to render cleanly.', 'err');
          done(); return;
        }
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            const b64 = String(rd.result).split(',')[1] || '';
            const r = await api.uploadImage({ name: file.name, type: file.type, data: b64 });
            f.image_url.value = r.url;
            toast('Uploaded — save the post to use it');
          } catch (err) { toast(err.message, 'err'); }
          done();
        };
        rd.readAsDataURL(file);
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); toast('That file does not look like an image.', 'err'); done(); };
      img.src = objUrl;
    },
  }, 'Upload');

  const capField = (label, input, cap, hint) => h('div', { class: 'field' },
    h('span', { class: 'field-label' }, label, counter(input, cap)),
    input,
    hint ? h('span', { class: 'field-hint' }, hint) : null);

  modal(isNew ? 'New post' : 'Edit post',
    h('div', { class: 'form' },
      capField('Kicker', f.kicker, LIMITS.kicker, 'The short label above the title.'),
      capField('Title', f.title, LIMITS.title, 'Wrap the word that should be green in asterisks: Built to *Win*.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Preview'), preview),
      capField('Body', f.body, LIMITS.body),
      isStellar ? null : field('Date text (optional)', f.date_text),
      isStellar ? null : h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Links (optional, up to 4)'), ctaList, addCta),
      isStellar ? null : field('Image (optional)',
        h('div', { class: 'img-field' }, f.image_url, h('div', { class: 'img-up' }, fileIn, upBtn)),
        'Shows as a small circle beside the text on desktop, hidden on mobile — never let it carry the message.'),
      isStellar ? h('p', { class: 'field-hint' }, 'The Stellar widget renders kicker, title and body only.') : null),
    [
      { label: 'Cancel', onClick: c => c() },
      {
        label: isNew ? 'Create' : 'Save', kind: 'accent', onClick: async c => {
          try {
            const ctas = [...ctaList.children].map(r => r._get()).filter(x => x.label && x.href);
            await api.saveBanner({
              id: b.id, board, kicker: f.kicker.value, title: toHtml(f.title.value), body: f.body.value,
              date_text: f.date_text.value, ctas, image_url: f.image_url.value.trim(),
              sort: b.sort, active: b.active,
            });
            c(); toast(isNew ? 'Post created' : 'Post saved'); rerender();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ]);
}
