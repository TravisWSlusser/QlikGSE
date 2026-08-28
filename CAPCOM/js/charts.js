/* charts.js — hand-rolled chart pieces, no library.

   Method notes (the dataviz procedure, applied):
   - Forms: stat tiles for headline numbers; horizontal bars for magnitude
     comparisons (territories, streams); columns for the daily series;
     a histogram for score spread. All single-measure, one axis, no dual-axis
     anywhere.
   - Color: these are MAGNITUDE charts, so they use one sequential hue
     (--viz-seq, the validated dark-mode blue #3987e5), not a categorical
     rainbow. Identity lives in the row label, not the bar color. Qlik green
     stays a UI accent and never colors a data mark.
   - Marks: thin bars, rounded at the data end only, flat at the baseline;
     2px surface gaps; direct value labels in ink (text tokens, never the
     series color); recessive gridlines.
   - Hover: every mark carries a tooltip with the full numbers. */
import { h, fmt } from './util.js';

let tipEl = null;
function tip() {
  if (!tipEl) { tipEl = h('div', { id: 'viz-tip' }); document.body.appendChild(tipEl); }
  return tipEl;
}
function showTip(e, html) {
  const t = tip();
  t.innerHTML = html;
  t.style.display = 'block';
  const pad = 14;
  const w = t.offsetWidth, ww = window.innerWidth;
  let x = e.clientX + pad;
  if (x + w > ww - 8) x = e.clientX - w - pad;
  t.style.left = x + 'px';
  t.style.top = (e.clientY + pad) + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

export function statTile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-value' }, value),
    h('div', { class: 'tile-label' }, label),
    sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

/* Horizontal magnitude bars. rows: [{label, value, display?, tipHtml?}].
   Direct labels on every row (few rows by construction), so no legend and
   no axis — the numbers ARE the axis. */
export function hbars(rows, { max = null, unit = '' } = {}) {
  const top = max || Math.max(1, ...rows.map(r => r.value));
  return h('div', { class: 'hbars' }, rows.map(r => {
    const pctW = Math.max(0.5, 100 * r.value / top);
    const row = h('div', { class: 'hbar-row' },
      h('span', { class: 'hbar-label' }, r.label),
      h('div', { class: 'hbar-track' },
        h('div', { class: 'hbar-fill', style: { width: pctW + '%' } })),
      h('span', { class: 'hbar-value' }, r.display != null ? r.display : fmt.int(r.value) + unit));
    if (r.tipHtml) {
      row.addEventListener('mousemove', e => showTip(e, r.tipHtml));
      row.addEventListener('mouseleave', hideTip);
    }
    return row;
  }));
}

/* Column chart over an ordered series. rows: [{label, value, tipHtml}].
   SVG so the bars stay crisp at any width; rounded at the data end, flat at
   the baseline; hairline gridlines at ~4 steps; sparse x labels. */
export function columns(rows, { height = 160 } = {}) {
  const wrap = h('div', { class: 'cols-wrap' });
  if (!rows.length) return wrap;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 720, H = height, padB = 20, padT = 8, padL = 4, padR = 4;
  const plotH = H - padB - padT;
  const top = Math.max(1, ...rows.map(r => r.value));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'cols');

  // recessive gridlines: quarter steps, no numbers (tooltip carries exacts)
  for (let i = 1; i <= 3; i++) {
    const y = padT + plotH * (i / 4);
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', padL); ln.setAttribute('x2', W - padR);
    ln.setAttribute('y1', y); ln.setAttribute('y2', y);
    ln.setAttribute('class', 'grid');
    svg.appendChild(ln);
  }
  const base = document.createElementNS(NS, 'line');
  base.setAttribute('x1', padL); base.setAttribute('x2', W - padR);
  base.setAttribute('y1', padT + plotH); base.setAttribute('y2', padT + plotH);
  base.setAttribute('class', 'baseline');
  svg.appendChild(base);

  const n = rows.length;
  const slot = (W - padL - padR) / n;
  const barW = Math.max(3, Math.min(26, slot - 2)); // 2px surface gap
  rows.forEach((r, i) => {
    const bh = Math.max(r.value > 0 ? 2 : 0, plotH * r.value / top);
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padT + plotH - bh;
    const rx = Math.min(4, barW / 2, bh); // rounded data end, flat baseline
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d',
      `M${x},${y + bh} L${x},${y + rx} Q${x},${y} ${x + rx},${y} L${x + barW - rx},${y} ` +
      `Q${x + barW},${y} ${x + barW},${y + rx} L${x + barW},${y + bh} Z`);
    p.setAttribute('class', 'col-bar');
    p.addEventListener('mousemove', e => showTip(e, r.tipHtml || r.label));
    p.addEventListener('mouseleave', hideTip);
    svg.appendChild(p);
  });

  wrap.appendChild(svg);
  // sparse x labels: first, middle, last — the tooltip names every column
  const lab = h('div', { class: 'cols-labels' },
    h('span', null, rows[0].label),
    h('span', null, rows[Math.floor(n / 2)].label),
    h('span', null, rows[n - 1].label));
  wrap.appendChild(lab);
  return wrap;
}
