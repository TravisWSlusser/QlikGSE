/* recmap.js — the REC Room's territory map, ported into CAPCOM.
 *
 * The map is not a mapping library and never was: four PNG silhouettes used
 * as CSS mask-image, each filled with its territory's color. That is why it
 * ports in one file — there is no projection, no geo data and no dependency,
 * just `/QlikRecRoom/assets/images/map_elements/*.png` served from the same
 * origin. An absolute path is deliberate: CAPCOM answers on BOTH /CAPCOM/
 * and /ControlRoom/ (see vercel.json), so a relative one would resolve
 * differently depending on which door you came in.
 *
 * Differences from the room's copy, on purpose:
 *
 *  - All four territories stay lit. The room lights only the scored top 3,
 *    which is good drama for players and bad for an enablement board, where
 *    "LATAM is dark" should mean "LATAM has no points", not "LATAM is 4th".
 *    Standing is carried by the ring and the rank badge instead.
 *  - The panel keeps its navy ground in BOTH themes. These are neon colors
 *    chosen against #10172A; on CAPCOM's light page they would glow. A map
 *    that looks the same as the one on the wall is also easier to talk about
 *    in a room where both are on screen.
 *
 * burst() is the live part: a score bubble pops over the territory that just
 * banked points. Positioning goes through the same contain/center math the
 * CSS masks use, so a burst lands on the right landmass at any panel size —
 * the room learned that the hard way when a canvas at its intrinsic 300x150
 * put every burst on NAM.
 */
import { h, clear, fmt } from './util.js';

const BASE = '/QlikRecRoom/assets/images/map_elements/';
export const TERR_KEYS = ['nam', 'latam', 'emea', 'apac'];
export const TERR_COLOR = {
  nam: '#9B59FF', latam: '#FF2D9B', emea: '#FF6B35', apac: '#10CFC9',
};

/* Centroid of each landmass as a fraction of the shared world image,
   measured from the PNGs themselves. */
const MAP_IMG_ASPECT = 4798 / 2471;
const TERR_FRAC = {
  nam: { x: 0.2376, y: 0.2369 },
  latam: { x: 0.2958, y: 0.6909 },
  emea: { x: 0.5245, y: 0.4865 },
  apac: { x: 0.7417, y: 0.3697 },
};

const RANK_MARK = ['🥇', '🥈', '🥉', ''];

export function recMap() {
  const stack = h('div', { class: 'rm-stack' },
    TERR_KEYS.map(k => h('div', {
      class: 'rm-layer ' + k,
      style: {
        '--terr': TERR_COLOR[k],
        '-webkit-mask-image': `url('${BASE}${k.toUpperCase()}_map.png')`,
        'mask-image': `url('${BASE}${k.toUpperCase()}_map.png')`,
      },
    })));

  const pins = h('div', { class: 'rm-pins' });
  const bubbles = h('div', { class: 'rm-bubbles' });
  const el = h('div', { class: 'rm-panel' },
    h('div', { class: 'rm-grid' }),
    h('div', { class: 'rm-radar' }),
    stack, pins, bubbles,
    h('div', { class: 'rm-legend' }, TERR_KEYS.map(k =>
      h('span', { class: 'rm-leg' },
        h('i', { class: 'rm-dot', style: { background: TERR_COLOR[k] } }),
        k.toUpperCase()))));

  /* Where a burst or pin belongs, in panel pixels. The masks are
     `mask-size: contain`, so the image is letterboxed inside the panel and
     the fractions have to be mapped through the same fit. */
  function point(key) {
    const f = TERR_FRAC[key] || TERR_FRAC.nam;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return { x: 0, y: 0 };
    let dw, dh, ox, oy;
    if (W / H > MAP_IMG_ASPECT) { dh = H; dw = H * MAP_IMG_ASPECT; ox = (W - dw) / 2; oy = 0; }
    else { dw = W; dh = W / MAP_IMG_ASPECT; ox = 0; oy = (H - dh) / 2; }
    return { x: ox + f.x * dw, y: oy + f.y * dh };
  }

  /* territories: the analytics payload's rows, already DESC by points. */
  function paint(territories) {
    const rows = (territories || []).map(t => ({
      key: String(t.territory || '').toLowerCase(),
      points: Number(t.points || 0),
      players: Number(t.players || 0),
    })).filter(t => TERR_KEYS.includes(t.key));
    const ranked = rows.slice().sort((a, b) => b.points - a.points);
    const rankOf = {};
    ranked.forEach((t, i) => { rankOf[t.key] = t.points > 0 ? i : 3; });

    TERR_KEYS.forEach(k => {
      const layer = stack.querySelector('.rm-layer.' + k);
      // The leader gets the halo. Nobody gets dimmed to nothing: a region
      // with no points still reads as a place on the board.
      if (layer) layer.classList.toggle('lead', rankOf[k] === 0);
    });

    clear(pins);
    ranked.forEach(t => {
      const p = point(t.key);
      const rank = rankOf[t.key];
      pins.appendChild(h('div', {
        class: 'rm-pin' + (rank === 0 ? ' lead' : ''),
        style: { left: p.x + 'px', top: p.y + 'px', '--terr': TERR_COLOR[t.key] },
      },
        h('b', null, t.key.toUpperCase(), RANK_MARK[rank] ? ' ' + RANK_MARK[rank] : ''),
        h('span', null, fmt.int(t.points), ' pts'),
        h('i', null, fmt.int(t.players), t.players === 1 ? ' player' : ' players')));
    });
  }

  /* One score bubble over a territory. Self-removing — no pool to manage,
     because CAPCOM sees a handful of new runs a minute, not a game loop. */
  function burst(territory, points, label) {
    const key = String(territory || '').toLowerCase();
    if (!TERR_KEYS.includes(key)) return;
    const p = point(key);
    const b = h('div', {
      class: 'rm-bubble',
      style: { left: p.x + 'px', top: p.y + 'px', '--terr': TERR_COLOR[key] },
    },
      h('span', { class: 'rm-b-label' }, label || key.toUpperCase()),
      h('span', { class: 'rm-b-score' }, '+' + fmt.int(points)));
    bubbles.appendChild(b);
    requestAnimationFrame(() => b.classList.add('in'));
    setTimeout(() => { b.classList.remove('in'); b.classList.add('out'); }, 3200);
    setTimeout(() => b.remove(), 3700);
  }

  // The pins are absolutely positioned in panel pixels, so a resize has to
  // re-place them. Cheap, and it dies with the view.
  let last = null;
  const ro = new ResizeObserver(() => { if (last) paint(last); });
  ro.observe(el);

  return {
    el,
    paint(t) { last = t; paint(t); },
    burst,
    stop() { ro.disconnect(); },
  };
}
