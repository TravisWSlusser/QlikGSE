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

/* Donut: composition of one whole. slices: [{label, value, colorVar, tipHtml?}]
   where colorVar is a CSS custom-property NAME ('--ps-blue') — resolved by
   the browser at paint, so both themes work with no JS. The legend column
   carries direct values (label · n · pct); the numbers ARE the legend. */
export function donut(slices, { size = 148, thickness = 18, centerLabel = '', centerSub = '' } = {}) {
  const wrap = h('div', { class: 'donut-wrap' });
  const total = slices.reduce((s, x) => s + x.value, 0);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'donut');
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const GAP = total > 0 && slices.filter(s => s.value > 0).length > 1 ? 2 : 0;
  let offset = C / 4; // start at 12 o'clock
  for (const s of slices) {
    if (!(s.value > 0) || total <= 0) continue;
    const len = Math.max(0, C * (s.value / total) - GAP);
    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', cx); arc.setAttribute('cy', cy); arc.setAttribute('r', r);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', `var(${s.colorVar})`);
    arc.setAttribute('stroke-width', thickness);
    arc.setAttribute('stroke-dasharray', `${len} ${C - len}`);
    arc.setAttribute('stroke-dashoffset', offset);
    arc.setAttribute('class', 'donut-arc');
    arc.addEventListener('mousemove', e => showTip(e, s.tipHtml || s.label));
    arc.addEventListener('mouseleave', hideTip);
    svg.appendChild(arc);
    offset -= len + GAP;
  }
  const face = h('div', { class: 'donut-face' }, svg,
    h('div', { class: 'donut-center' },
      h('div', { class: 'donut-big' }, centerLabel),
      centerSub ? h('div', { class: 'donut-sub' }, centerSub) : null));
  const legend = h('div', { class: 'donut-legend' }, slices.map(s =>
    h('div', { class: 'donut-key' },
      h('span', { class: 'donut-dot', style: { background: `var(${s.colorVar})` } }),
      h('span', { class: 'donut-key-label' }, s.label),
      h('span', { class: 'donut-key-val' },
        `${fmt.int(s.value)}${total > 0 ? ` · ${Math.round(100 * s.value / total)}%` : ''}`))));
  wrap.append(face, legend);
  return wrap;
}

/* Gantt: phase spans over a date range. rows:
   [{ label, href?, segments:[{startIso, endIso, colorVar, tipHtml}],
      due?: {iso, overdue, tipHtml} }]
   Dates are date-only ISO strings; x is linear in days across [from, to].
   The caller clamps segments to the range — this only maps iso → x.
   Lives in .gantt-wrap: a sticky label column beside a .gantt-scroll
   (overflow-x:auto) holding an SVG wide enough that a quarter SCROLLS on
   a phone instead of squashing. */
export function gantt(rows, { from, to } = {}) {
  const wrap = h('div', { class: 'gantt-wrap' });
  if (!rows.length) return wrap;
  const NS = 'http://www.w3.org/2000/svg';
  const dnum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const d0 = dnum(from), d1 = Math.max(d0 + 1, dnum(to));
  const days = d1 - d0;
  const PPD = days > 130 ? 4 : days > 60 ? 7 : 12;       // px per day
  const ROW = 30, AXIS = 26, PADR = 10;
  const W = Math.max(640, days * PPD + PADR), H = AXIS + rows.length * ROW + 6;
  const x = iso => Math.max(0, Math.min(W - PADR, (dnum(iso) - d0) * PPD));

  const labels = h('div', { class: 'gantt-labels' },
    h('div', { class: 'gantt-axis-spacer' }),
    rows.map(r => h(r.href ? 'a' : 'div', { class: 'gantt-label', href: r.href || null }, r.label)));

  const scroll = h('div', { class: 'gantt-scroll' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('class', 'gantt');

  // month ticks along the top (week ticks when the range is short)
  const t0 = new Date(d0 * 86400000);
  const stepDays = days <= 45 ? 7 : 0; // 0 = month boundaries
  const ticks = [];
  if (stepDays) {
    for (let d = d0; d <= d1; d += stepDays) ticks.push(d);
  } else {
    const c = new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1));
    while (c.getTime() / 86400000 <= d1) {
      if (c.getTime() / 86400000 >= d0) ticks.push(c.getTime() / 86400000);
      c.setUTCMonth(c.getUTCMonth() + 1);
    }
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const d of ticks) {
    const dt = new Date(d * 86400000);
    const tx = (d - d0) * PPD;
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', tx); ln.setAttribute('x2', tx);
    ln.setAttribute('y1', AXIS - 6); ln.setAttribute('y2', H);
    ln.setAttribute('class', 'grid');
    svg.appendChild(ln);
    const tl = document.createElementNS(NS, 'text');
    tl.setAttribute('x', tx + 4); tl.setAttribute('y', AXIS - 10);
    tl.setAttribute('class', 'gantt-tick');
    tl.textContent = stepDays ? `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}` : MONTHS[dt.getUTCMonth()];
    svg.appendChild(tl);
  }
  // the today hairline — viewer-local is fine for a cosmetic marker
  const nowIso = new Date().toLocaleDateString('en-CA');
  if (dnum(nowIso) >= d0 && dnum(nowIso) <= d1) {
    const tx = (dnum(nowIso) - d0) * PPD;
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', tx); ln.setAttribute('x2', tx);
    ln.setAttribute('y1', AXIS - 4); ln.setAttribute('y2', H);
    ln.setAttribute('class', 'gantt-today');
    svg.appendChild(ln);
  }

  rows.forEach((r, i) => {
    const yMid = AXIS + i * ROW + ROW / 2;
    for (const s of r.segments) {
      const x1 = x(s.startIso), x2 = Math.max(x1 + 2, x(s.endIso));
      const bar = document.createElementNS(NS, 'rect');
      bar.setAttribute('x', x1); bar.setAttribute('y', yMid - 6);
      bar.setAttribute('width', x2 - x1); bar.setAttribute('height', 12);
      bar.setAttribute('rx', 5);
      bar.setAttribute('fill', `var(${s.colorVar})`);
      bar.setAttribute('class', 'gantt-bar');
      bar.addEventListener('mousemove', e => showTip(e, s.tipHtml || r.label));
      bar.addEventListener('mouseleave', hideTip);
      svg.appendChild(bar);
    }
    if (r.due && dnum(r.due.iso) >= d0 && dnum(r.due.iso) <= d1) {
      const dx = x(r.due.iso);
      const dm = document.createElementNS(NS, 'path');
      dm.setAttribute('d', `M${dx},${yMid - 8} L${dx + 6},${yMid} L${dx},${yMid + 8} L${dx - 6},${yMid} Z`);
      dm.setAttribute('class', 'gantt-due' + (r.due.overdue ? ' late' : ''));
      dm.addEventListener('mousemove', e => showTip(e, r.due.tipHtml || 'Phase due'));
      dm.addEventListener('mouseleave', hideTip);
      svg.appendChild(dm);
    }
  });

  scroll.appendChild(svg);
  wrap.append(labels, scroll);
  return wrap;
}
