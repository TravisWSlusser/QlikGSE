/* preview.js — "see what they see".
 *
 * Travis needed to check what a staff member's CAPCOM looks like before
 * showing the platform to the wider team, without logging out, without
 * creating a throwaway account, and without touching anyone's real access.
 *
 * It works because the sidebar is driven by exactly one thing: allowed() in
 * app.js reads WHO.scopes and nothing else. Swap the identity the shell
 * renders against and the nav rearranges itself.
 *
 * WHAT THIS IS NOT — and the banner says so out loud:
 * this previews the NAV, not the permission boundary. Every API call still
 * carries YOUR key, so a page opened during a preview will happily load data
 * that person could not actually fetch. It answers "what do they see in the
 * sidebar", never "what can they do". The real boundary is requireScope on
 * the server, and the only honest test of it is signing in as them.
 *
 * Session-only on purpose: no localStorage. A preview must never survive a
 * refresh, or someone will eventually debug a permissions problem that is
 * really just a preview nobody remembered leaving on.
 */
let PREVIEW = null;
const subs = [];

export const preview = {
  get() { return PREVIEW; },
  active() { return !!PREVIEW; },
  /* who: { name, scopes[] } — a manager preview passes the full scope list */
  set(who) {
    PREVIEW = who && Array.isArray(who.scopes)
      ? { name: who.name || 'staff member', scopes: who.scopes.slice() }
      : null;
    subs.forEach(f => { try { f(); } catch (e) {} });
  },
  clear() { PREVIEW = null; subs.forEach(f => { try { f(); } catch (e) {} }); },
  onChange(f) { subs.push(f); },
};

/* The identity the shell should RENDER against. A previewed staff member is
 * never a manager, master or people leader — dropping those is what hides
 * the Leadership Brief and the Setup banner, which scopes alone would not. */
export function effectiveWho(real) {
  if (!PREVIEW) return real;
  return {
    ...real,
    label: PREVIEW.name,
    scopes: PREVIEW.scopes,
    master: false, manager: false, people_leader: false, leader: false,
  };
}
