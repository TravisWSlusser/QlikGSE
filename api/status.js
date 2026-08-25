/* /api/status — kept as its own path because pages and widgets already call it
 * (SalesCommand/stellar.html, qlikmt-hero.html), but it is NO LONGER its own
 * implementation.
 *
 * It used to be a byte-for-byte duplicate of lib/command/status.js: the same
 * two fetchers, the same service list, its own cache. Adding Mindtickle to the
 * lib copy therefore changed /api/command/status and left /api/status exactly
 * as it was — the endpoint everything actually calls. That cost a full
 * diagnosis before the duplication turned up.
 *
 * One implementation now. Add a service in lib/command/status.js and both
 * paths get it.
 */
import status from '../lib/command/status.js';

export default function handler(req, res) {
  return status(req, res);
}
