/* How long a retired question survives before it is deleted for good.
 *
 * ONE definition, deliberately. The purge (listQuestions) and the countdown
 * ring in the Control Room both need this number, and the client gets it in
 * the listQuestions payload rather than hardcoding its own copy — a second
 * copy is exactly how the Blitz preloader drifted out of step with the clip
 * counts it was supposed to preload.
 *
 * Retiring is therefore a soft delete with a grace period, not an archive.
 * Inside the window Restore puts the row back untouched; past it the row and
 * its attempted/correct history are gone, and nothing references a question
 * id from outside its own table, so nothing is left dangling.
 */
export const RETIRE_HOURS = 48;
