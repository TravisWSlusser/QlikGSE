// /api/recroom.js — single-function router for the recroom namespace.
// Hobby plan caps 12 functions/deployment; vercel.json rewrites
// /api/recroom/<action> -> here, so client paths never change.
import exportData from '../lib/recroom/exportData.js';
import getEvents from '../lib/recroom/getEvents.js';
import getLeaderboard from '../lib/recroom/getLeaderboard.js';
import getRecentScores from '../lib/recroom/getRecentScores.js';
import getTerritoryHigh from '../lib/recroom/getTerritoryHigh.js';
import logScore from '../lib/recroom/logScore.js';
import lookupTrigram from '../lib/recroom/lookupTrigram.js';
import trend from '../lib/recroom/trend.js';
import updateIdentity from '../lib/recroom/updateIdentity.js';

const HANDLERS = {
  exportData,
  getEvents,
  getLeaderboard,
  getRecentScores,
  getTerritoryHigh,
  logScore,
  lookupTrigram,
  trend,
  updateIdentity
};

export default async function handler(req, res) {
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown recroom action', action });
  return fn(req, res);
}
