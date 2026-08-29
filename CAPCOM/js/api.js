/* api.js — the only file that calls fetch (the BRUCE rule). Every endpoint is
   one line. The admin key rides in the x-admin-key header, never a URL. */

const KEY_STORE = 'capcom.key';

export const keyStore = {
  get() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set(k) { try { localStorage.setItem(KEY_STORE, k); } catch {} },
  clear() { try { localStorage.removeItem(KEY_STORE); } catch {} },
};

async function call(action, { method = 'GET', body = null, query = '' } = {}) {
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
  giphySearch: (q, type) => call('giphySearch', { query: `?q=${encodeURIComponent(q)}&type=${type}` }),

  /* The one non-admin fetch: the public calendar feed, so Home can rebuild
     the widget for every key holder regardless of scope. */
  publicEvents: async () => {
    const r = await fetch('/api/command/events', { cache: 'no-store' });
    if (!r.ok) throw new Error('Calendar feed unavailable');
    return r.json();
  },
};
