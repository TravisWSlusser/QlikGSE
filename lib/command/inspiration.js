// =============================================================
//  /api/command/inspiration — the Enablement News Feed.
//
//  Aggregates a CURATED list of reputable L&D / enablement blogs (every
//  feed verified live on 1 Sep 2026) and keeps only items touching the
//  two themes Travis asked for: SALES ENABLEMENT and AI. No API keys,
//  no dependencies — plain RSS over fetch, parsed with regexes tolerant
//  of RSS and Atom shapes.
//
//  Caching follows lib/command/news.js exactly (read its header for the
//  per-region edge-cache lesson): one api_cache row is the global source
//  of truth, TTL 3 hours (blogs move slowly), served stale up to 48h
//  rather than empty. The neon import is LAZY so this module also runs
//  standalone under plain node for testing — no database just means no
//  cache, never a failure.
// =============================================================

const FEEDS = [
  // starred: Travis studied under Kapp (gamification of learning — the REC
  // Room's spiritual grandfather). Everything he posts is included, badged,
  // and floated when fresh — no theme gate.
  { name: 'Karl Kapp', url: 'https://karlkapp.com/feed/', star: true },
  { name: 'Sales Enablement Collective', url: 'https://www.salesenablementcollective.com/rss/', always: 'enablement' },
  { name: 'Josh Bersin', url: 'https://joshbersin.com/feed/' },
  { name: 'Dr Philippa Hardman', url: 'https://drphilippahardman.substack.com/feed' },
  { name: 'Donald Clark Plan B', url: 'https://donaldclarkplanb.blogspot.com/feeds/posts/default?alt=rss' },
  { name: 'Work-Learning Research', url: 'https://www.worklearning.com/feed/' },
  { name: 'Learnlets', url: 'https://blog.learnlets.com/feed/' },
  { name: 'Experiencing eLearning', url: 'https://www.christytuckerlearning.com/feed/' },
  { name: '3-Star Learning Experiences', url: 'https://3starlearningexperiences.wordpress.com/feed/' },
  { name: 'The Learning Scientists', url: 'https://www.learningscientists.org/blog?format=rss' },
  { name: 'eLearning Industry', url: 'https://elearningindustry.com/feed' },
];

const AI_RE = /\bAI\b|artificial intelligence|\bGPT\b|\bLLMs?\b|copilot|chatbots?|machine learning|generative|ChatGPT|deep ?learning agents?|\bagentic\b/i;
const SE_RE = /sales|enablement|seller|revenue|onboarding|coaching|readiness|go.to.market|\bGTM\b|pipeline|quota|customer.facing/i;

const CACHE_KEY = 'inspiration';
const TTL_MIN = 180;
const STALE_MAX_HRS = 48;
const PER_SOURCE = 4;   // nobody floods the feed
const TOTAL = 30;

/* minimal entity decode + tag strip — enough for headlines */
function clean(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ').trim();
}

function parseFeed(xml, feed) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 15)) {
    const pick = tag => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const title = clean(pick('title'));
    let link = clean(pick('link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);   // Atom self-closing
      if (m) link = clean(m[1]);
    }
    const published = clean(pick('pubDate') || pick('published') || pick('updated') || pick('dc:date'));
    const desc = clean(pick('description') || pick('summary') || pick('content:encoded')).slice(0, 400);
    if (!title || !/^https?:\/\//i.test(link)) continue;

    const hay = `${title} ${desc}`;
    const themes = [];
    if (AI_RE.test(hay)) themes.push('ai');
    if (SE_RE.test(hay) || feed.always === 'enablement') themes.push('enablement');
    if (!themes.length && !feed.star) continue;          // themed only — except starred voices

    out.push({ title, url: link, source: feed.name, published, themes, ...(feed.star ? { starred: true } : {}) });
  }
  return out;
}

async function fetchFresh() {
  const results = await Promise.allSettled(FEEDS.map(async f => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6500);
    try {
      const r = await fetch(f.url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (QlikGSE Enablement Feed)' },
      });
      if (!r.ok) return [];
      return parseFeed(await r.text(), f).slice(0, PER_SOURCE);
    } finally { clearTimeout(t); }
  }));
  const all = [].concat(...results.map(r => r.status === 'fulfilled' ? r.value : []));
  all.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  const seen = new Set(), items = [];
  for (const it of all) {
    const key = it.title.toLowerCase().slice(0, 60);
    if (!seen.has(key)) { seen.add(key); items.push(it); }
  }
  // a fresh post from a starred voice floats above the stream
  const freshStar = it => it.starred && (Date.now() - new Date(it.published || 0)) < 30 * 86400000 ? 1 : 0;
  items.sort((a, b) => (freshStar(b) - freshStar(a)) || (new Date(b.published || 0) - new Date(a.published || 0)));
  // empty = every feed failed dressed as success — never cache it over a good row
  return items.length ? items.slice(0, TOTAL) : null;
}

/* db cache — lazy neon so the module runs standalone for testing */
async function db() {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const conn = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED
      || process.env.STORAGE_URL || process.env.POSTGRES_URL;
    return conn ? neon(conn) : null;
  } catch { return null; }
}

async function readCache() {
  const sql = await db();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT payload, EXTRACT(EPOCH FROM (now() - fetched_at)) / 60 AS age_min
      FROM api_cache WHERE key = ${CACHE_KEY} LIMIT 1`;
    return rows.length ? { items: rows[0].payload, ageMin: Number(rows[0].age_min) } : null;
  } catch {
    try {
      await sql`CREATE TABLE IF NOT EXISTS api_cache (
        key text PRIMARY KEY, payload jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now())`;
    } catch { /* no database: serve live */ }
    return null;
  }
}

async function writeCache(items) {
  const sql = await db();
  if (!sql) return;
  try {
    await sql`INSERT INTO api_cache (key, payload, fetched_at)
      VALUES (${CACHE_KEY}, ${JSON.stringify(items)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`;
  } catch { /* caching is an optimisation, never a failure path */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200');
  try {
    const cached = await readCache();
    if (cached && cached.ageMin < TTL_MIN) {
      return res.status(200).json({ items: cached.items });
    }
    const fresh = await fetchFresh();
    if (fresh) {
      await writeCache(fresh);
      return res.status(200).json({ items: fresh });
    }
    if (cached && cached.ageMin < STALE_MAX_HRS * 60) {
      return res.status(200).json({ items: cached.items, stale: true });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ items: [], degraded: true });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ items: [], degraded: true });
  }
}
