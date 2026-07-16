// /api/blitz.js — single-function router for the blitz namespace.
// Hobby plan caps 12 functions/deployment; vercel.json rewrites
// /api/blitz/<action> -> here, so client paths never change.
import checkAnswer from '../lib/blitz/checkAnswer.js';
import checkCoinAnswer from '../lib/blitz/checkCoinAnswer.js';
import checkTerm from '../lib/blitz/checkTerm.js';
import getCoinQuestions from '../lib/blitz/getCoinQuestions.js';
import getQuestions from '../lib/blitz/getQuestions.js';
import getScores from '../lib/blitz/getScores.js';
import getTerms from '../lib/blitz/getTerms.js';
import lookupTrigram from '../lib/blitz/lookupTrigram.js';

const HANDLERS = {
  checkAnswer,
  checkCoinAnswer,
  checkTerm,
  getCoinQuestions,
  getQuestions,
  getScores,
  getTerms,
  lookupTrigram
};

export default async function handler(req, res) {
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown blitz action', action });
  return fn(req, res);
}
