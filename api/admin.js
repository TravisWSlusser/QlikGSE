/*
  /api/admin/:action — the Control Room's namespace. vercel.json rewrites the
  path segment to ?action=, same as the other three routers.

  Every action gates itself through lib/admin/auth.js (requireScope) — this
  router adds no checking of its own, so a new action CANNOT be reachable
  without deciding its scope: the import will not compile without one.

  Same hazard as the other namespaces, sharper here: these imports are
  static, so a syntax error in ONE lib/admin file takes down the entire
  admin API. Parse-check before pushing.
*/
import migrate from '../lib/admin/migrate.js';
import whoami from '../lib/admin/whoami.js';
import listEvents from '../lib/admin/listEvents.js';
import saveEvent from '../lib/admin/saveEvent.js';
import deleteEvent from '../lib/admin/deleteEvent.js';
import saveCategory from '../lib/admin/saveCategory.js';
import listBanners from '../lib/admin/listBanners.js';
import saveBanner from '../lib/admin/saveBanner.js';
import deleteBanner from '../lib/admin/deleteBanner.js';
import listQuestions from '../lib/admin/listQuestions.js';
import saveQuestion from '../lib/admin/saveQuestion.js';
import deleteQuestion from '../lib/admin/deleteQuestion.js';
import analytics from '../lib/admin/analytics.js';
import maintenance from '../lib/admin/maintenance.js';
import keys from '../lib/admin/keys.js';
import uploadImage from '../lib/admin/uploadImage.js';
import listLog from '../lib/admin/listLog.js';
import questionStats from '../lib/admin/questionStats.js';
import secrets from '../lib/admin/secrets.js';
import systemStatus from '../lib/admin/systemStatus.js';
import setStaff from '../lib/admin/setStaff.js';
import hotlinks from '../lib/admin/hotlinks.js';
import dedupeTerms from '../lib/admin/dedupeTerms.js';
import stickies from '../lib/admin/stickies.js';
import giphySearch from '../lib/admin/giphySearch.js';

const HANDLERS = {
  migrate, whoami,
  listEvents, saveEvent, deleteEvent, saveCategory,
  listBanners, saveBanner, deleteBanner,
  listQuestions, saveQuestion, deleteQuestion,
  analytics, maintenance, keys, uploadImage,
  listLog, questionStats, secrets, systemStatus, setStaff, hotlinks, dedupeTerms, stickies, giphySearch,
};

export default async function handler(req, res) {
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown admin action', action });
  return fn(req, res);
}
