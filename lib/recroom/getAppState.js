import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

/* Maintenance switch.
 *
 * Lives in the DATABASE, not an env var and not a file, because the whole
 * point is to flip it WITHOUT a deploy — Travis needs to close the doors,
 * let the writes settle, run a migration or a wipe, and reopen. A Vercel env
 * var would need a redeploy each way, which is exactly the thing you cannot
 * do while mid-update.
 *
 * Toggle it from the Neon SQL editor (see the runbook in CLAUDE.md).
 *
 * FAILS OPEN, ALWAYS. A missing table, an unreachable database, a malformed
 * row — every one of them returns "online". A maintenance check that can take
 * the room down by accident is worse than having no maintenance check, so the
 * only thing that closes the room is an explicit 'on' read back from a healthy
 * query.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // No caching: the point of this endpoint is that it changes the moment the
  // row changes. A cached "online" would keep players in during a wipe.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const rows = await sql`
      SELECT key, value FROM app_state
      WHERE key IN ('maintenance', 'maintenance_message', 'maintenance_eta')
    `;
    const map = {};
    for (const r of rows) map[r.key] = (r.value || '').toString();

    const on = (map.maintenance || '').trim().toLowerCase() === 'on';

    return res.status(200).json({
      maintenance: on,
      message: map.maintenance_message || 'The REC Room is closed for a short update.',
      eta: map.maintenance_eta || ''
    });
  } catch (err) {
    // Deliberately a 200 with maintenance:false. The clients treat any failure
    // as "carry on", and returning a clean shape here means they never have to
    // parse an error to work that out.
    return res.status(200).json({ maintenance: false, degraded: true });
  }
}
