/* util.js — the BRUCE toolbox, ported. h() hyperscript, $, and formatters.
   No dependencies, no framework. */

export const $ = id => document.getElementById(id);

/* h(tag, props, ...kids) → a real DOM node.
   props: className via class or className, style object or string, on* handlers,
   dataset via data, everything else setAttribute/property. Kids: nodes, strings,
   arrays, null/undefined skipped. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k];
    if (v == null) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // Object.assign silently DROPS custom properties ('--evc') — they only
      // land via setProperty. This is why every category bar rendered grey.
      for (const sk of Object.keys(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
        else el.style[sk] = v[sk];
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v; // explicit opt-in, used only for server-sanitised banner previews
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  const add = kid => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) return kid.forEach(add);
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const fmt = {
  int: n => Number(n || 0).toLocaleString('en-US'),
  pct: (c, a) => a > 0 ? (100 * c / a).toFixed(1) + '%' : '—',
  day: iso => { // '2026-09-14' → 'Sep 14' — built from parts, never new Date(iso)
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  dur: s => { s = Number(s || 0); const m = Math.floor(s / 60); return m ? `${m}m ${s % 60}s` : `${s}s`; },
  // ISO timestamp → the VIEWER's local time, AM/PM — so the same change
  // reads as 3:30 PM in Philadelphia and 9:30 PM in Amsterdam.
  when: iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
};

/* Past-date check, same parts-based construction as the calendar pages —
   new Date('2026-09-01') parses UTC and shifts a day west of Greenwich. */
export function isPast(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return dt < today;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
