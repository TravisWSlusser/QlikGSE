/* api.js — the only file that calls fetch (the BRUCE rule). Every endpoint is
   one line. The admin key rides in the x-admin-key header, never a URL. */

import { preview } from './preview.js';

const KEY_STORE = 'capcom.key';

export const keyStore = {
  get() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set(k) { try { localStorage.setItem(KEY_STORE, k); } catch {} },
  clear() { try { localStorage.removeItem(KEY_STORE); } catch {} },
};

/* ── preview mode is READ-ONLY, and this is where that is true ──
 *
 * A preview reshapes the sidebar to someone else's access. Every request
 * still carries YOUR key, so a write made during one would be recorded as
 * YOU — posting, reacting or commenting while "being" someone else is
 * both confusing and, in a log, misleading. Travis asked for it to be
 * look-only.
 *
 * Enforced here rather than by hiding buttons, because there are dozens
 * of write controls and a missed one fails open. Every request in CAPCOM
 * goes through call(); nothing else touches fetch (the BRUCE rule).
 *
 * The list below is of READS. Anything not on it is refused while a
 * preview is running. That direction matters: a read left off the list
 * shows an error in a preview, which is annoying; a write left off would
 * execute, which is the thing we are preventing.
 */
const READ_ONLY = {
  // action: true = always a read, or a Set of ops that are reads
  whoami: true, listEvents: true, listBanners: true, listQuestions: true,
  analytics: true, listLog: true, questionStats: true, systemStatus: true,
  maintenance: true,            // GET form only; the POST form carries a body
  giphySearch: true,
  keys: new Set(['list']),
  secrets: new Set(['list']),
  hotlinks: new Set(['list']),
  stickies: new Set(['list']),
  timeline: new Set(['list', 'feed', 'thread']),
  trophies: new Set(['list']),
  projects: new Set(['list', 'review', 'log']),
  members: new Set([]),         // every members op writes
  brief: new Set(['digest']),   // 'narrate' spends a Claude call
  roster: new Set(['stats']),
};

function readOnlyOK(action, body) {
  const rule = READ_ONLY[action];
  if (rule === true) return !body || !Object.keys(body).length || action === 'whoami';
  if (rule instanceof Set) return rule.has((body && body.op) || '');
  return false;
}

async function call(action, { method = 'GET', body = null, query = '' } = {}) {
  if (preview.active() && !readOnlyOK(action, body)) {
    const err = new Error('You are previewing someone else\u2019s view \u2014 it is look-only. Exit preview to make changes.');
    err.status = 0;
    err.preview = true;
    throw err;
  }
  const res = await fetch(`/api/admin/${action}${query}`, {
    method,
    headers: {
      'x-admin-key': keyStore.get(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${action} failed (${res.status})`);
    err.status = res.status;
    err.detail = data && data.detail;
    throw err;
  }
  return data;
}

export const api = {
  whoami: () => call('whoami', { method: 'POST', body: {} }),
  migrate: () => call('migrate', { method: 'POST', body: {} }),

  listEvents: () => call('listEvents'),
  saveEvent: e => call('saveEvent', { method: 'POST', body: e }),
  deleteEvent: id => call('deleteEvent', { method: 'POST', body: { id } }),
  saveCategory: c => call('saveCategory', { method: 'POST', body: c }),

  listBanners: () => call('listBanners'),
  saveBanner: b => call('saveBanner', { method: 'POST', body: b }),
  deleteBanner: id => call('deleteBanner', { method: 'POST', body: { id } }),
  uploadImage: f => call('uploadImage', { method: 'POST', body: f }),
  uploadAvatar: f => call('uploadImage', { method: 'POST', body: { ...f, kind: 'avatar' } }),

  listQuestions: table => call('listQuestions', { query: `?table=${encodeURIComponent(table)}` }),
  saveQuestion: q => call('saveQuestion', { method: 'POST', body: q }),
  deleteQuestion: (table, id) => call('deleteQuestion', { method: 'POST', body: { table, id } }),

  analytics: () => call('analytics'),

  maintenanceGet: () => call('maintenance'),
  maintenanceSet: m => call('maintenance', { method: 'POST', body: m }),

  keys: body => call('keys', { method: 'POST', body }),
  secrets: body => call('secrets', { method: 'POST', body }),
  listLog: () => call('listLog'),
  questionStats: () => call('questionStats'),
  systemStatus: () => call('systemStatus'),
  setStaff: (trigram, staff) => call('setStaff', { method: 'POST', body: { trigram, staff } }),
  hotlinks: body => call('hotlinks', { method: 'POST', body }),
  stickies: body => call('stickies', { method: 'POST', body }),
  timeline: body => call('timeline', { method: 'POST', body }),
  trophies: body => call('trophies', { method: 'POST', body }),
  uploadTrophy: f => call('uploadImage', { method: 'POST', body: { ...f, kind: 'trophy' } }),
  projects: body => call('projects', { method: 'POST', body }),
  projectsAdmin: body => call('projectsAdmin', { method: 'POST', body }),
  members: body => call('members', { method: 'POST', body }),
  memberClaim: body => call('memberClaim', { method: 'POST', body }),
  bugs: body => call('bugs', { method: 'POST', body }),
  brief: body => call('brief', { method: 'POST', body }),
  roster: body => call('roster', { method: 'POST', body }),
  giphySearch: (q, type) => call('giphySearch', { query: `?q=${encodeURIComponent(q)}&type=${type}` }),

  /* The one non-admin fetch: the public calendar feed, so Home can rebuild
     the widget for every key holder regardless of scope. */
  publicEvents: async () => {
    const r = await fetch('/api/command/events', { cache: 'no-store' });
    if (!r.ok) throw new Error('Calendar feed unavailable');
    return r.json();
  },
  inspiration: async () => {
    const r = await fetch('/api/command/inspiration', { cache: 'no-store' });
    if (!r.ok) throw new Error('The news feed is unavailable');
    return r.json();
  },
};
