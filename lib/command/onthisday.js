// /api/onthisday.js  — Vercel serverless proxy for "On This Day" events.
// Drop this in your repo's /api folder next to market.js and news.js.
// Source: Wikimedia "On this day" feed (free, no API key required).
// The widget calls /api/onthisday?m=<month>&d=<day> and picks one factoid per
// 6-hour slot (so it changes ~4x/day). Cached 6h at the edge to stay light.

export default async function handler(req, res) {
  try {
    const now = new Date();
    const m = String(req.query.m || now.getMonth() + 1).padStart(2, '0');
    const d = String(req.query.d || now.getDate()).padStart(2, '0');

    // Keyless Wikimedia REST feed. A descriptive User-Agent is requested by Wikimedia.
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m}/${d}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'QlikMT-Enablement/1.0 (Travis.Slusser@Qlik.com)',
        'Accept': 'application/json'
      }
    });

    if (!r.ok) {
      res.status(200).json({ events: [] });
      return;
    }

    const json = await r.json();
    const events = (json.events || [])
      .map(e => ({ year: e.year, text: String(e.text || '').slice(0, 180) }))
      .filter(e => e.year && e.text)
      .slice(0, 40);

    // Cache 6h at the CDN, serve stale for a day while revalidating.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({ events });
  } catch (err) {
    // Fail soft — the widget falls back to its built-in factoids.
    res.status(200).json({ events: [] });
  }
}
