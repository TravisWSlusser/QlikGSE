/* giphy.js — the sticker/meme drawer.
 *
 * Lifted out of home.js when status reactions needed it too. It was always
 * general; it just happened to be born on the corkboard. Nothing about it
 * changed in the move, so a sticker reaction on a profile and a sticker
 * pinned to the cork come from the same picker and the same endpoint.
 */
import { h, clear } from './util.js';
import { api } from './api.js';
import { textInput } from './ui.js';

/* giphyGrid(onPick) → the search box, the Stickers/Memes tabs and the
   results drawer. onPick(url) fires when a cell is chosen; the caller
   decides what "chosen" means (a modal's Save, or an instant post). */
export function giphyGrid(onPick) {
  const q = textInput({ placeholder: 'Search — “high five”, “deal closed”, “facepalm”…' });
  let type = 'stickers';
  const grid = h('div', { class: 'gif-grid' },
    h('p', { class: 'sub' }, 'Search to fill the drawer.'));
  const tabs = h('div', { class: 'gif-tabs' },
    ['stickers', 'gifs'].map(t => h('button', {
      class: 'btn xs' + (t === type ? ' accent' : ''),
      onClick: e => {
        type = t;
        [...tabs.children].forEach(x => x.classList.remove('accent'));
        e.target.classList.add('accent');
        if (q.value.trim()) run();
      },
    }, t === 'stickers' ? 'Stickers' : 'Memes')));
  async function run() {
    clear(grid).appendChild(h('p', { class: 'sub' }, 'Searching…'));
    try {
      const d = await api.giphySearch(q.value.trim(), type);
      clear(grid);
      if (!(d.results || []).length) { grid.appendChild(h('p', { class: 'sub' }, 'Nothing for that — try other words.')); return; }
      for (const g of d.results) {
        const cell = h('button', { class: 'gif-cell', title: g.title, onClick: () => {
          [...grid.children].forEach(x => x.classList && x.classList.remove('on'));
          cell.classList.add('on');
          onPick(g.url);
        } }, h('img', { src: g.preview, alt: g.title, loading: 'lazy' }));
        grid.appendChild(cell);
      }
    } catch (err) { clear(grid).appendChild(h('p', { class: 'sub' }, err.message)); }
  }
  q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  return h('div', { class: 'form' },
    h('div', { class: 'gif-search' }, q, h('button', { class: 'btn', onClick: run }, 'Search'), tabs),
    grid);
}
