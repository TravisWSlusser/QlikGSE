import { sql, requireScope, cors } from './auth.js';
import { SCHEMA_VERSION, DEPLOY_NOTES } from './schemaVersion.js';

/*
  POST /api/admin/whoami — validates a key and returns its scopes, so the
  Control Room can build its nav before making a single domain call. Any
  valid key passes; an invalid one gets the same 401 as everywhere else.

  Also carries the two flags the update banner needs:
  - leader: this member session leads an active team (leaders may run
    Setup without the system scope — Travis's leadership circle).
  - setup_pending: the deployed code's SCHEMA_VERSION is ahead of the
    stamp Setup last wrote. An unreadable stamp (app_state missing —
    Setup never ran) counts as pending; that is exactly the situation
    the banner exists for.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, null);
  if (!who) return;

  let leader = false;
  if (who.member) {
    try {
      const lead = await sql`SELECT id FROM project_teams
        WHERE active = true AND leader_id = ${who.member.id} LIMIT 1`;
      leader = lead.length > 0;
    } catch { /* registry missing — nobody leads anything yet */ }
  }

  let setup_pending = false, schema_stamp = null;
  try {
    const v = await sql`SELECT value FROM app_state WHERE key = 'schema_version' LIMIT 1`;
    schema_stamp = v.length ? Number(v[0].value) : null;
    setup_pending = schema_stamp == null || schema_stamp < SCHEMA_VERSION;
  } catch { setup_pending = true; }

  res.status(200).json({
    ok: true, label: who.label, scopes: who.scopes, master: !!who.master,
    manager: !!who.manager,
    member: who.member || null, leader, setup_pending,
    code_version: SCHEMA_VERSION, schema_stamp, deploy_notes: DEPLOY_NOTES,
  });
}
