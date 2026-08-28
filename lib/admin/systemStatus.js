import { list } from '@vercel/blob';
import { sql, requireScope, cors } from './auth.js';
import { getSecret } from '../secrets.js';
import { blobToken } from './blob.js';

/*
  GET /api/admin/systemStatus — live health of everything the apps stand on,
  for the Dashboard's status board. Analytics scope.

  Each probe returns { id, name, group, status, detail, ms? }:
    ok    green — working, verified just now
    warn  amber — working but degraded, stale, or deliberately altered
    down  red   — broken or unreachable
    off   gray  — not configured (a choice, not a failure)

  Probes run in parallel with individual timeouts; one hanging service can
  neither block nor fail the others. Quota-aware on purpose: MarketAux and
  GNews are 100 requests/DAY, so they are judged by the freshness of the
  news cache they feed rather than pinged directly — a status board that
  burns the day's quota checking quota is self-defeating. Results cache 60s
  per warm lambda; the board polls once a minute, so a cold start pays once.
*/
let cache = { at: 0, data: null };

const T = (p, ms = 5000) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
]);
const ago = min => min < 2 ? 'just now' : min < 60 ? `${Math.round(min)}m ago`
  : min < 2880 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 1440)}d ago`;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, 'analytics');
  if (!who) return;

  if (cache.data && Date.now() - cache.at < 60_000) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(cache.data);
  }

  const base = `https://${req.headers.host}`;
  const probes = {

    db: async () => {
      const t0 = Date.now();
      await T(sql`SELECT 1`);
      return { name: 'Neon database', group: 'Core', status: 'ok', detail: 'Query round-trip', ms: Date.now() - t0 };
    },

    blob: async () => {
      const token = blobToken();
      if (!token) return { name: 'Vercel Blob', group: 'Core', status: 'off', detail: 'No token configured' };
      const t0 = Date.now();
      await T(list({ limit: 1, token }));
      return { name: 'Vercel Blob', group: 'Core', status: 'ok', detail: 'Image store reachable', ms: Date.now() - t0 };
    },

    resend: async () => {
      if (!process.env.RESEND_API_KEY) return { name: 'Resend email', group: 'Core', status: 'off', detail: 'No API key — notifications off' };
      const t0 = Date.now();
      // Probe the SEND endpoint with an empty body — auth is checked before
      // validation, so 401/403 means bad key while 4xx-validation means the
      // key is good and nothing was sent. (A send-only key 401s on every
      // read endpoint, which made the first version of this probe cry wolf
      // about a perfectly working key.)
      const r = await T(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      }));
      if (r.status === 401 || r.status === 403) return { name: 'Resend email', group: 'Core', status: 'down', detail: 'API key rejected' };
      if (r.status >= 500) return { name: 'Resend email', group: 'Core', status: 'warn', detail: `Resend responded ${r.status}` };
      return { name: 'Resend email', group: 'Core', status: 'ok', detail: 'Notifications ready', ms: Date.now() - t0 };
    },

    events: async () => {
      const t0 = Date.now();
      const r = await T(fetch(`${base}/api/command/events`, { cache: 'no-store' }));
      const d = await r.json();
      if (d.degraded) return { name: 'Calendar feed', group: 'Feeds', status: 'warn', detail: 'Serving degraded — pages on fallback copy' };
      const n = (d.events || []).length;
      if (!n) return { name: 'Calendar feed', group: 'Feeds', status: 'warn', detail: 'Empty — pages on fallback copy' };
      return { name: 'Calendar feed', group: 'Feeds', status: 'ok', detail: `${n} events live`, ms: Date.now() - t0 };
    },

    banners: async () => {
      const t0 = Date.now();
      const [hl, st] = await Promise.all([
        T(fetch(`${base}/api/command/banners?board=highlights`, { cache: 'no-store' })).then(r => r.json()),
        T(fetch(`${base}/api/command/banners?board=stellar`, { cache: 'no-store' })).then(r => r.json()),
      ]);
      const hn = (hl.posts || []).length, sn = (st.posts || []).length;
      if (hl.degraded || st.degraded) return { name: 'Banner feeds', group: 'Feeds', status: 'warn', detail: 'Serving degraded — pages on fallback copy' };
      if (!hn || !sn) return { name: 'Banner feeds', group: 'Feeds', status: 'warn', detail: `hero ${hn} · stellar ${sn} — an empty board falls back` };
      return { name: 'Banner feeds', group: 'Feeds', status: 'ok', detail: `hero ${hn} · stellar ${sn} live`, ms: Date.now() - t0 };
    },

    mindtickle: async () => {
      const t0 = Date.now();
      const r = await T(fetch('https://status.mindtickle.com/api/v2/status.json'));
      const d = await r.json();
      const ind = (d.status && d.status.indicator) || 'none';
      if (ind === 'none') return { name: 'Mindtickle', group: 'Partners', status: 'ok', detail: 'All systems operational', ms: Date.now() - t0 };
      return { name: 'Mindtickle', group: 'Partners', status: ind === 'critical' || ind === 'major' ? 'down' : 'warn', detail: (d.status && d.status.description) || ind };
    },

    finnhub: async () => {
      const key = await getSecret('FINNHUB_API_KEY');
      if (!key) return { name: 'Finnhub markets', group: 'Partners', status: 'off', detail: 'No API key' };
      const t0 = Date.now();
      const r = await T(fetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${key}`));
      if (r.status === 401 || r.status === 403) return { name: 'Finnhub markets', group: 'Partners', status: 'down', detail: 'API key rejected' };
      if (r.status === 429) return { name: 'Finnhub markets', group: 'Partners', status: 'warn', detail: 'Rate limited' };
      if (!r.ok) return { name: 'Finnhub markets', group: 'Partners', status: 'warn', detail: `Responded ${r.status}` };
      return { name: 'Finnhub markets', group: 'Partners', status: 'ok', detail: 'Quotes flowing', ms: Date.now() - t0 };
    },

    // Judged by the cache they feed, never pinged — 100/day quotas.
    news: async () => {
      const g = await getSecret('GNEWS_API_KEY');
      const m = await getSecret('MARKETAUX_API_KEY');
      if (!g && !m) return { name: 'News (GNews/MarketAux)', group: 'Partners', status: 'off', detail: 'No API keys' };
      try {
        const rows = await T(sql`SELECT EXTRACT(EPOCH FROM (now() - fetched_at))/60 AS age FROM api_cache ORDER BY fetched_at DESC LIMIT 1`);
        if (!rows.length) return { name: 'News (GNews/MarketAux)', group: 'Partners', status: 'warn', detail: 'Keys set, cache never filled' };
        const age = Number(rows[0].age);
        if (age > 60 * 24) return { name: 'News (GNews/MarketAux)', group: 'Partners', status: 'warn', detail: `Cache stale — last fill ${ago(age)}` };
        return { name: 'News (GNews/MarketAux)', group: 'Partners', status: 'ok', detail: `Cache filled ${ago(age)}` };
      } catch {
        return { name: 'News (GNews/MarketAux)', group: 'Partners', status: 'warn', detail: 'Cache table unreadable' };
      }
    },

    heartbeat: async () => {
      const rows = await T(sql`SELECT EXTRACT(EPOCH FROM (now() - created_at))/60 AS age FROM score_events ORDER BY id DESC LIMIT 1`);
      if (!rows.length) return { name: 'Game heartbeat', group: 'REC Room', status: 'warn', detail: 'No runs ever recorded' };
      const age = Number(rows[0].age);
      // Quiet is not broken — an org sleeps. Only flag real silence.
      if (age > 60 * 72) return { name: 'Game heartbeat', group: 'REC Room', status: 'warn', detail: `Last run ${ago(age)} — unusually quiet` };
      return { name: 'Game heartbeat', group: 'REC Room', status: 'ok', detail: `Last run ${ago(age)}` };
    },

    banks: async () => {
      const [q, c, t] = await T(Promise.all([
        sql`SELECT count(*)::int AS n FROM questions WHERE active = true`,
        sql`SELECT count(*)::int AS n FROM methodology_questions WHERE active = true`,
        sql`SELECT count(*)::int AS n FROM glossary_terms WHERE active = true`,
      ]));
      const [qn, cn, tn] = [q[0].n, c[0].n, t[0].n];
      const detail = `${qn} knowledge · ${cn} methodology · ${tn} glossary`;
      // Floors the game needs: 4 / 4 / ~30 (glossary feeds the distractor pool).
      if (qn < 4 || cn < 4 || tn < 30) return { name: 'Question banks', group: 'REC Room', status: 'down', detail: detail + ' — below the game’s floor' };
      if (qn < 8 || cn < 8 || tn < 35) return { name: 'Question banks', group: 'REC Room', status: 'warn', detail: detail + ' — running thin' };
      return { name: 'Question banks', group: 'REC Room', status: 'ok', detail };
    },

    maintenance: async () => {
      const rows = await T(sql`SELECT value FROM app_state WHERE key = 'maintenance' LIMIT 1`);
      const on = rows.length && (rows[0].value || '').trim().toLowerCase() === 'on';
      if (on) return { name: 'REC Room doors', group: 'REC Room', status: 'warn', detail: 'CLOSED for maintenance — deliberate' };
      return { name: 'REC Room doors', group: 'REC Room', status: 'ok', detail: 'Open, scores accepted' };
    },
  };

  const ids = Object.keys(probes);
  const settled = await Promise.allSettled(ids.map(id => probes[id]()));
  const systems = settled.map((r, i) => {
    if (r.status === 'fulfilled') return { id: ids[i], ...r.value };
    return {
      id: ids[i], name: ids[i], group: 'Core', status: 'down',
      detail: String(r.reason && r.reason.message || r.reason).slice(0, 80),
    };
  });

  const counts = { down: 0, warn: 0, off: 0, ok: 0 };
  for (const s of systems) counts[s.status] = (counts[s.status] || 0) + 1;
  const payload = {
    checkedAt: new Date().toISOString(),
    overall: counts.down ? 'down' : counts.warn ? 'warn' : 'ok',
    counts, systems,
  };
  cache = { at: Date.now(), data: payload };
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(payload);
}
