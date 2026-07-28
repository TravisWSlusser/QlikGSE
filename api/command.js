// /api/command.js — single-function router for the command namespace.
// Hobby plan caps 12 functions/deployment; vercel.json rewrites
// /api/command/<action> -> here, so client paths never change.
import market from '../lib/command/market.js';
import news from '../lib/command/news.js';
import onthisday from '../lib/command/onthisday.js';
import status from '../lib/command/status.js';

const HANDLERS = {
  market,
  news,
  onthisday,
  status
};

export default async function handler(req, res) {
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown command action', action });
  return fn(req, res);
}
