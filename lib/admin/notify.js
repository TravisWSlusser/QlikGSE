import { sql } from './auth.js';
import { getSecret } from '../secrets.js';

/*
  Email notification for secret changes, via Resend's REST API.

  Needs RESEND_API_KEY in the Vercel env (env-only on purpose — the mail
  channel is part of the trust root: if a compromised admin key could
  silently repoint or disable notifications, the notifications would be
  worthless exactly when they matter).

  The recipient comes from the NOTIFY_EMAIL secret (seeded to Travis).
  Not configured → {sent:false, reason} and the caller carries on; the
  change itself is never blocked by mail problems.

  ⚠ The mail INCLUDES THE FULL NEW VALUE, because Travis asked to see what
  it changed to. Email is not an encrypted channel — if that trade ever
  stops being worth it, flip INCLUDE_VALUE to false and the mail reports
  the masked form the change feed uses.
*/
const INCLUDE_VALUE = true;

export function maskSecret(v) {
  const s = String(v || '');
  if (!s) return '(empty)';
  if (s.length <= 8) return '••••';
  return s.slice(0, 3) + '…' + s.slice(-4);
}

export async function notifySecretChange(name, desc, value, who) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY is not configured' };

  let to = '';
  try { to = await getSecret('NOTIFY_EMAIL'); } catch {}
  if (!to) return { sent: false, reason: 'NOTIFY_EMAIL is not set' };

  const shown = INCLUDE_VALUE ? String(value || '(cleared — env value now applies)') : maskSecret(value);
  const body = [
    `A key was changed in CAPCOM.`,
    ``,
    `Key:        ${name}`,
    `Used for:   ${desc}`,
    `Changed by: ${who && who.label ? who.label : 'unknown'}`,
    `When:       ${new Date().toISOString()}`,
    ``,
    `New value:  ${shown}`,
    ``,
    `If this wasn't expected, revoke the admin key that made the change`,
    `(CAPCOM → Access & Setup) and set the value back.`,
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CAPCOM <onboarding@resend.dev>',
        to: [to],
        subject: `CAPCOM: ${name} was updated`,
        text: body,
      }),
    });
    if (!r.ok) return { sent: false, reason: `Resend ${r.status}` };
    return { sent: true, to };
  } catch (e) {
    return { sent: false, reason: String(e) };
  }
}
