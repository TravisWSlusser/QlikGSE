import { requireScope, cors } from './auth.js';
import { getSecret } from '../secrets.js';

/*
  GET /api/admin/giphySearch?q=...&type=stickers|gifs — the Corkboard's
  sticker drawer, proxied so GIPHY_API_KEY never reaches a browser.

  Any valid CAPCOM key may search — the board is a community surface and
  our own key gate fronts the traffic. Rating is pinned to pg-13 (this is
  a work wall), limit 24. The beta key allows 100 calls/hour, which a
  handful of leaders picking stickers will never dent; a 429 comes back as
  a friendly "give it a few minutes" rather than an error dump.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, null);
  if (!who) return;

  const q = (req.query.q || '').toString().trim().slice(0, 80);
  const type = req.query.type === 'gifs' ? 'gifs' : 'stickers';
  if (!q) return res.status(400).json({ error: 'Give me something to search' });

  const key = await getSecret('GIPHY_API_KEY');
  if (!key) return res.status(500).json({ error: 'GIPHY_API_KEY is not configured (Keys & Services)' });

  try {
    const r = await fetch(
      `https://api.giphy.com/v1/${type}/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=en`,
      { signal: AbortSignal.timeout(6000) });
    if (r.status === 429) return res.status(429).json({ error: 'GIPHY is rate-limited — give it a few minutes' });
    if (r.status === 401 || r.status === 403) return res.status(500).json({ error: 'GIPHY rejected the API key' });
    if (!r.ok) return res.status(502).json({ error: `GIPHY responded ${r.status}` });
    const d = await r.json();
    const results = (d.data || []).map(g => {
      const imgs = g.images || {};
      const preview = (imgs.fixed_width_small || imgs.fixed_width || imgs.original || {}).url || '';
      const full = (imgs.fixed_width || imgs.original || {}).url || preview;
      return { id: g.id, title: g.title || '', preview, url: full };
    }).filter(g => g.preview);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ results, type });
  } catch (err) {
    res.status(502).json({ error: 'GIPHY unreachable', detail: String(err) });
  }
}
