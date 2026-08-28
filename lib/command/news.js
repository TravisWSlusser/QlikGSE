// =============================================================
//  /api/command/news  —  news ticker, merged from GNews + MarketAux
//
//  SETUP:
//   1. GNews    — GNEWS_API_KEY     (free tier: 100 requests/day)
//   2. MarketAux— MARKETAUX_API_KEY (free tier: 100 requests/day)
//   3. Redeploy.
//
//  EDIT THE FEED: change GNEWS_Q (topics) or MA_SYMBOLS (tickers).
//
//  WHY THIS CACHES IN THE DATABASE
//  -------------------------------
//  It used to rely on `Cache-Control: s-maxage=1200` alone. That is an EDGE
//  cache, and Vercel's edge caches PER REGION — so a sales org spread across
//  NAM/EMEA/APAC/LATAM gave every PoP its own 20-minute window:
//
//      1 region  ->  72 origin calls/day   (inside the 100/day free tier)
//      2 regions -> 144                    (over)
//      4 regions -> 288                    (well over)
//
//  plus background revalidations from stale-while-revalidate on top. That is
//  what blew the MarketAux limit.
//
//  The DB row is a single global source of truth: whichever region is asked
//  first does the fetch, writes the row, and every other region reads it. The
//  upstream call rate becomes a known quantity — 24h / TTL_MIN — no matter how
//  many PoPs or how much traffic.
//
//  Two extra properties fall out of it, both worth having:
//    * an upstream outage no longer empties the ticker — the last good payload
//      is served stale rather than nothing;
//    * a cold start no longer costs an API call, which in-memory caching could
//      never avoid.
// =============================================================
import { getSecret } from '../secrets.js';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const GNEWS_Q    = '("data analytics" OR "business intelligence" OR Qlik OR Snowflake OR Databricks OR "Power BI" OR "AI data")';
const MA_SYMBOLS  = 'SNOW,MSFT,CRM,NVDA,ORCL,PLTR';

const CACHE_KEY = 'news';
const TTL_MIN   = 30;          // 48 upstream calls/day, globally. Half the free tier.
const STALE_MAX_HRS = 12;      // serve a stale row rather than nothing, up to this old

/* Fetch both providers and merge. Only called on a cache miss. */
async function fetchFresh() {
  const g = await getSecret('GNEWS_API_KEY');
  const m = await getSecret('MARKETAUX_API_KEY');
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

  if (!tasks.length) return null;

  const all = [].concat(...await Promise.all(tasks));
  all.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

  const seen = new Set(), items = [];
  for (const it of all) {
    const key = (it.title || '').toLowerCase().slice(0, 60);
    if (it.title && it.url && !seen.has(key)) { seen.add(key); items.push(it); }
  }
  // An empty result is a failed fetch dressed as a success — do not cache it
  // over a good row, or one upstream hiccup blanks the ticker for TTL_MIN.
  return items.length ? items.slice(0, 18) : null;
}

async function readCache() {
  try {
    const rows = await sql`
      SELECT payload,
             EXTRACT(EPOCH FROM (now() - fetched_at)) / 60 AS age_min
      FROM api_cache WHERE key = ${CACHE_KEY} LIMIT 1
    `;
    return rows.length ? { items: rows[0].payload, ageMin: Number(rows[0].age_min) } : null;
  } catch (e) {
    // Table may not exist yet. Create it lazily so this needs no manual DDL,
    // then behave as a miss.
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS api_cache (
          key        text PRIMARY KEY,
          payload    jsonb NOT NULL,
          fetched_at timestamptz NOT NULL DEFAULT now()
        )`;
    } catch (e2) { /* no database: fall through and serve live */ }
    return null;
  }
}

async function writeCache(items) {
  try {
    await sql`
      INSERT INTO api_cache (key, payload, fetched_at)
      VALUES (${CACHE_KEY}, ${JSON.stringify(items)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
    `;
  } catch (e) { /* caching is an optimisation, never a failure path */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Still worth an edge cache in front of the DB — it saves a query, and the
  // DB is what actually bounds the upstream call rate now.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');

  const cached = await readCache();
  if (cached && cached.ageMin < TTL_MIN) {
    return res.status(200).json({ updated: Date.now(), cached: true, ageMin: Math.round(cached.ageMin), items: cached.items });
  }

  const fresh = await fetchFresh();
  if (fresh) {
    await writeCache(fresh);
    return res.status(200).json({ updated: Date.now(), cached: false, items: fresh });
  }

  // Upstream gave us nothing. A stale ticker beats an empty one.
  if (cached && cached.ageMin < STALE_MAX_HRS * 60) {
    return res.status(200).json({ updated: Date.now(), cached: true, stale: true, ageMin: Math.round(cached.ageMin), items: cached.items });
  }

  return res.status(502).json({ error: 'news fetch failed' });
}
