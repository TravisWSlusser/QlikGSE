/* Dynamic web app manifest.
 *
 * WHY THIS EXISTS
 * ---------------
 * An installed copy has to launch with the session key or it cannot score, and
 * the two obvious routes both fail on iOS:
 *
 *   - localStorage: a standalone web app on iOS gets its OWN storage container,
 *     so the key stashed by Safari is simply not there.
 *   - "no start_url, inherit the install URL": per spec a missing start_url
 *     defaults to the document URL, which would have carried ?k=. Tested on a
 *     real iPhone and it does NOT survive — the installed app launched without
 *     the key and every run came back "score not validated".
 *
 * So the key travels in the manifest. mobile.html points its <link rel="manifest">
 * at this endpoint with its own ?k=, and start_url comes back carrying it.
 * Recent iOS honours manifest start_url; older iOS ignores the manifest and
 * uses the document URL, which also has the key. Both paths land with a key.
 *
 * PATHS MUST BE ABSOLUTE. Manifest members resolve relative to the MANIFEST's
 * URL, and this one is served from /api/recroom/manifest — so "assets/icons/..."
 * would resolve to /api/recroom/assets/icons/... and every icon would 404.
 *
 * The key is echoed, never checked. Validating it against the real keys would
 * turn this endpoint into an oracle you could brute-force a key out of, one
 * request at a time. A wrong key installs an app that cannot score, which is
 * the caller's problem and nobody else's.
 */

const BASE = '/QlikRecRoom/';

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = (req.query.k || '').toString();
  // Charset gate only: keep it to what a session key can plausibly be, so a
  // hand-edited URL cannot stuff anything odd into start_url. JSON.stringify
  // does the escaping either way; this just keeps the value sane.
  const key = /^[A-Za-z0-9._~-]{1,128}$/.test(raw) ? raw : '';

  const start = BASE + 'mobile.html' + (key ? '?k=' + encodeURIComponent(key) : '');

  const manifest = {
    name: 'REC Room',
    short_name: 'REC Room',
    description: 'Rank. Elevate. Compete. — Qlik Sales Enablement',
    start_url: start,
    scope: BASE,
    display: 'standalone',
    orientation: 'any',          // badge and board are portrait-first; Play locks its own
    background_color: '#0a1020',
    theme_color: '#10CFC9',
    icons: [
      { src: BASE + 'assets/icons/recroom-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: BASE + 'assets/icons/recroom-256.png', sizes: '256x256', type: 'image/png' },
      { src: BASE + 'assets/icons/recroom-384.png', sizes: '384x384', type: 'image/png' },
      { src: BASE + 'assets/icons/recroom-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
    ]
  };

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  // Never shared cache: the response is keyed to one session key.
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.status(200).send(JSON.stringify(manifest));
}
