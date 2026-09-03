import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = neon(CONN);

/*
  Runtime-editable secrets, CAPCOM's "Keys & Services" store.

  Lives at lib/ root (the excluded.js precedent) because BOTH namespaces
  read it: recroom's logScore/updateIdentity for the session keys, command
  for the news/market API keys, exportData for EXPORT_KEY.

  Resolution order: app_secrets row → env var of the same name → ''.
  The env fallback is what makes this safe to ship before migrate runs and
  what keeps Vercel the emergency override — clear a bad DB value and the
  env value is authoritative again.

  DELIBERATELY NOT HERE: DATABASE_URL, BLOB_READ_WRITE_TOKEN, ADMIN_KEY,
  RESEND_API_KEY. Those are the trust root — the app boots from them, and a
  UI that could rewrite them could lock everyone out (or let a leaked admin
  key quietly rotate the admin key). They stay env-only, forever.

  60s in-memory cache per warm lambda: the hot paths (logScore) should not
  pay a query per call, and a key rotation taking up to a minute to bite is
  the same tolerance the session-key overlap rotation already assumes.
*/
export const MANAGED = {
  MT_SESSION_REF: 'REC Room session key (desktop widget ?k=)',
  MT_SESSION_REF_MOBILE: 'REC Room session key (mobile widget ?k=)',
  EXPORT_KEY: 'CSV export key (?key= on exportData)',
  MARKETAUX_API_KEY: 'MarketAux — Mission Control news ticker',
  GNEWS_API_KEY: 'GNews — Mission Control news fallback',
  FINNHUB_API_KEY: 'Finnhub — Mission Control markets ribbon',
  GIPHY_API_KEY: 'GIPHY — Corkboard stickers and memes',
  ANTHROPIC_API_KEY: 'Claude — writes the Leadership Brief’s executive summary',
  NOTIFY_EMAIL: 'Where key-change notifications are sent',
};
export const ENV_ONLY = ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'ADMIN_KEY', 'ULTRA_ADMIN_KEY', 'RESEND_API_KEY'];

const cache = { at: 0, map: null };

export async function getSecret(name) {
  const now = Date.now();
  if (!cache.map || now - cache.at > 60_000) {
    try {
      const rows = await sql`SELECT name, value FROM app_secrets`;
      cache.map = Object.fromEntries(rows.map(r => [r.name, r.value]));
    } catch { cache.map = cache.map || {}; }
    cache.at = now;
  }
  const v = cache.map[name];
  return (v != null && v !== '') ? v : (process.env[name] || '');
}

/* For the admin UI: where each value currently comes from, without the value. */
export async function secretSource(name) {
  const rows = await sql`SELECT value, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS at, updated_by
    FROM app_secrets WHERE name = ${name} LIMIT 1`;
  if (rows.length && rows[0].value) return { src: 'app', value: rows[0].value, at: rows[0].at, by: rows[0].updated_by };
  if (process.env[name]) return { src: 'env', value: process.env[name] };
  return { src: 'unset', value: '' };
}

export function bustSecretCache() { cache.at = 0; cache.map = null; }
