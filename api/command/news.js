// =============================================================
//  /api/news.js  —  Vercel serverless function (News ticker)
//
//  Pulls from BOTH sources and merges them. Works with either or
//  both keys present (set what you have; missing source is skipped).
//
//  SETUP:
//   1. GNews — reuse your existing key. In THIS Vercel project add
//        GNEWS_API_KEY = your_key   (env vars are per-project, so it
//        must be added here even if AI-HQ already has it).
//   2. MarketAux — free key at https://marketaux.com → add
//        MARKETAUX_API_KEY = your_key
//   3. Redeploy.
//
//  EDIT THE FEED: change GNEWS_Q (topics) or MA_SYMBOLS (tickers).
//  Cached 20 min at the edge to stay inside the free daily limits.
// =============================================================

const GNEWS_Q   = '("data analytics" OR "business intelligence" OR Qlik OR Snowflake OR Databricks OR "Power BI" OR "AI data")';
const MA_SYMBOLS = 'SNOW,MSFT,CRM,NVDA,ORCL,PLTR';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=3600');

  const g = process.env.GNEWS_API_KEY;
  const m = process.env.MARKETAUX_API_KEY;
  const tasks = [];

  if (g) tasks.push(
    fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(GNEWS_Q)}&lang=en&max=10&sortby=publishedAt&apikey=${g}`)
      .then(r => r.json())
      .then(d => (d.articles || []).map(a => ({ title: a.title, url: a.url, source: (a.source && a.source.name) || '', published: a.publishedAt })))
      .catch(() => [])
  );

  if (m) tasks.push(
    fetch(`https://api.marketaux.com/v1/news/all?symbols=${MA_SYMBOLS}&filter_entities=true&language=en&limit=10&api_token=${m}`)
      .then(r => r.json())
      .then(d => (d.data || []).map(a => ({ title: a.title, url: a.url, source: a.source || '', published: a.published_at })))
      .catch(() => [])
  );

  if (!tasks.length) return res.status(500).json({ error: 'No news API key configured' });

  try {
    const results = await Promise.all(tasks);
    const all = [].concat(...results);
    all.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
    const seen = new Set(), items = [];
    for (const it of all) {
      const key = (it.title || '').toLowerCase().slice(0, 60);
      if (it.title && it.url && !seen.has(key)) { seen.add(key); items.push(it); }
    }
    return res.status(200).json({ updated: Date.now(), items: items.slice(0, 18) });
  } catch (e) {
    return res.status(502).json({ error: 'news fetch failed' });
  }
}
