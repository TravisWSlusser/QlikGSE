import { requireScope, cors } from './auth.js';

/*
  POST /api/admin/whoami — validates a key and returns its scopes, so the
  Control Room can build its nav before making a single domain call. Any
  valid key passes; an invalid one gets the same 401 as everywhere else.
*/
export default async function handler(req, res) {
  if (cors(req, res)) return;
  const who = await requireScope(req, res, null);
  if (!who) return;
  res.status(200).json({ ok: true, label: who.label, scopes: who.scopes, master: !!who.master, member: who.member || null });
}
