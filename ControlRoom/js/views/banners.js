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
  const root = h('div', { class: 'view' }, spinner());
  load(root, board, rerender);
  return root;
}

async function load(root, board, rerender) {
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

function editBanner(b, board, rerender) {
  const isNew = !b;
  const isStellar = board === 'stellar';
  b = b || { kicker: '', title: '', body: '', date_text: '', ctas: [], image_url: '', sort: 99, active: true };

  const f = {
    kicker: textInput({ value: b.kicker }),
    title: textInput({ value: b.title, placeholder: 'Wrap the accent word: Built to <span class="ac">Win</span>.' }),
    body: textArea({ value: b.body, rows: 3 }),
    date_text: textInput({ value: b.date_text, placeholder: 'August 14, 2026 — shows as “Added …”' }),
    image_url: textInput({ value: b.image_url, placeholder: 'https://… or upload below' }),
  };

  // live accent preview under the title box
  const preview = h('div', { class: 'bn-preview' });
  const paint = () => { preview.innerHTML = f.title.value || '<span class="dim">title preview</span>'; };
  f.title.addEventListener('input', paint); paint();

  // CTA editor — up to 4 {label, href}
  const ctaList = h('div', { class: 'cta-list' });
  const ctaRow = (c) => {
    const label = textInput({ value: c ? c.label : '', placeholder: 'Label', class: 'narrow' });
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
      if (file.size > 3 * 1024 * 1024) { toast('Max 3MB — it renders at most 190px wide', 'err'); return; }
      upBtn.disabled = true; upBtn.textContent = 'Uploading…';
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const b64 = String(rd.result).split(',')[1] || '';
          const r = await api.uploadImage({ name: file.name, type: file.type, data: b64 });
          f.image_url.value = r.url;
          toast('Uploaded — save the post to use it');
        } catch (err) { toast(err.message, 'err'); }
        upBtn.disabled = false; upBtn.textContent = 'Upload';
      };
      rd.readAsDataURL(file);
    },
  }, 'Upload');

  modal(isNew ? 'New post' : 'Edit post',
    h('div', { class: 'form' },
      field('Kicker', f.kicker, 'The short eyebrow label above the title.'),
      field('Title', f.title, 'HTML is stripped except the accent span and basic emphasis.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Preview'), preview),
      field('Body', f.body),
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
              id: b.id, board, kicker: f.kicker.value, title: f.title.value, body: f.body.value,
              date_text: f.date_text.value, ctas, image_url: f.image_url.value.trim(),
              sort: b.sort, active: b.active,
            });
            c(); toast(isNew ? 'Post created' : 'Post saved'); rerender();
          } catch (err) { toast(err.message, 'err'); }
        },
      },
    ]);
}
