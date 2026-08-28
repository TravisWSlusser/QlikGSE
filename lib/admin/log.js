import { sql } from './auth.js';

/*
  The change feed. Every admin write calls logChange after it succeeds, so
  the Home screen can answer "what happened lately, and who did it". The
  actor is the KEY LABEL (e.g. "master", "Huw — calendar"), which is the
  whole point of labeling keys.

  Fire-and-forget: a logging failure must never fail the write it describes
  (the logScore → score_events precedent). Before migrate creates admin_log
  this simply does nothing.
*/
export async function logChange(who, action, summary) {
  try {
    await sql`INSERT INTO admin_log (actor, action, summary)
      VALUES (${who && who.label ? who.label : 'unknown'}, ${action}, ${String(summary || '').slice(0, 200)})`;
  } catch { /* table missing or db blip — the write already succeeded */ }
}
