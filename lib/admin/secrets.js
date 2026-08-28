import { sql, requireScope, cors, parseBody } from './auth.js';
import { logChange } from './log.js';
import { MANAGED, ENV_ONLY, secretSource, bustSecretCache } from '../secrets.js';
import { notifySecretChange, maskSecret } from './notify.js';

/*
  POST /api/admin/secrets — the Keys & Services store. System scope only.

  { op: 'list' } → every managed slot with a MASKED value and where it
    currently resolves from (app = set here, env = Vercel fallback,
    unset = neither), plus the env-only roots as read-only rows.
    Full values are never returned — not to the UI, not to anyone. A key
    you can read out of a browser is a key you have already lost.

  { op: 'set', name, value } → writes the slot. Empty value clears the row
    so the env var (if any) applies again. Emails NOTIFY_EMAIL with the
    change; the change feed records only the masked form.

  Session keys must be alphanumeric — '#' truncates the widget URL before
  the request is made and '+' decodes as a space, both documented, both
  unfixable server-side.
*/
const URL_SAFE = /^[A-Za-z0-9-]*$/;
const URL_KEYS = ['MT_SESSION_REF', 'MT_SESSION_REF_MOBILE', 'EXPORT_KEY'];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const who = await requireScope(req, res, 'system');
  if (!who) return;

  const b = parseBody(req);
  const op = (b.op || '').toString();

  try {
    if (op === 'list') {
      const slots = [];
      for (const [name, desc] of Object.entries(MANAGED)) {
        const s = await secretSource(name);
        slots.push({
          name, desc, src: s.src,
          masked: name === 'NOTIFY_EMAIL' ? (s.value || '(unset)') : maskSecret(s.value),
          at: s.at || null, by: s.by || null,
        });
      }
      const roots = ENV_ONLY.map(name => ({
        name, src: process.env[name] ? 'env' : 'unset', readonly: true,
      }));
      return res.status(200).json({ slots, roots, mailReady: !!process.env.RESEND_API_KEY });
    }

    if (op === 'set') {
      const name = (b.name || '').toString();
      const value = (b.value == null ? '' : String(b.value)).trim();
      if (!(name in MANAGED)) return res.status(400).json({ error: 'Unknown key', keys: Object.keys(MANAGED) });
      if (value.length > 500) return res.status(400).json({ error: 'Value is too long (max 500)' });
      if (URL_KEYS.includes(name) && !URL_SAFE.test(value)) {
        return res.status(400).json({ error: 'Session and export keys must be letters, digits and dashes only — # and + get destroyed by URLs' });
      }
      if (name === 'NOTIFY_EMAIL' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return res.status(400).json({ error: 'That does not look like an email address' });
      }

      if (value) {
        await sql`INSERT INTO app_secrets (name, value, updated_by) VALUES (${name}, ${value}, ${who.label})
          ON CONFLICT (name) DO UPDATE SET value = ${value}, updated_at = now(), updated_by = ${who.label}`;
      } else {
        await sql`DELETE FROM app_secrets WHERE name = ${name}`;
      }
      bustSecretCache();

      await logChange(who, 'keys', value
        ? `Updated ${name} → ${maskSecret(value)}`
        : `Cleared ${name} (env value now applies)`);

      let mail = { sent: false, reason: 'skipped' };
      if (name !== 'NOTIFY_EMAIL' || !value) {
        mail = await notifySecretChange(name, MANAGED[name], value, who);
      } else {
        // Changing the notify address itself: tell the OLD address too if we
        // can, so a hijacked mailbox swap does not go silent. Best effort.
        mail = await notifySecretChange(name, MANAGED[name], value, who);
      }

      return res.status(200).json({ ok: true, name, notified: mail.sent, mailNote: mail.sent ? `Emailed ${mail.to}` : mail.reason });
    }

    res.status(400).json({ error: 'Bad op', ops: ['list', 'set'] });
  } catch (err) {
    res.status(500).json({ error: 'Secret operation failed — has Setup been run?', detail: String(err) });
  }
}
