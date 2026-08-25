# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this before the codex

There is a long-form **STELLAR-SELLER / SIDE-QLIK CODEX** that Travis will paste
in. It is excellent on intent, canon and vocabulary, and it is **specifically
stale on implementation**. Its own advice holds: the committed code wins. The
corrections below were verified against this repo and the live deployment on
2026-08-23/24 — check them again rather than trusting this file either.

**Codex says → repo actually has:**

- *Three repos (QlikRecRoom, QlikMT_Main, QlikMindtickleApps)* → **one repo,
  `QlikGSE`**. QlikRecRoom is a subdirectory; `qlikmt-hero.html` lives under
  `SalesCommand/`.
- *7 + 4 flat serverless functions* → **three routers over a lib layer**:
  `api/blitz.js` → `lib/blitz/*`, `api/command.js` → `lib/command/*`,
  `api/recroom.js` → `lib/recroom/*`, plus
  `api/status.js`. `vercel.json` rewrites `/api/<ns>/:action` to `?action=`.
  This is a workaround for Vercel's function-count limit — keep it.
- *Two question types* → **three, in three tables**: `questions` (knowledge,
  Brain Freeze), `methodology_questions` (coins — has `category` of
  `term`/`green_sheet`/`blue_sheet`, and `read_seconds`), `glossary_terms`
  (Brain Blast). `players` carries a counter pair for each: `q_*`, `c_*`, `t_*`.
- *Brain Blast is a board freeze* → it is a **3-question glossary scene**, 10s
  each, no feedback until a BAM-BAM-BAM reveal. All three right wipes the bottom
  3 rows at half points. 20s cooldown either way. `BB_TARGET=50`.
- *(absent)* → **Methodology Madness**: bank 3 coins, weighted wheel picks 1–5
  colourless glitch bombs that vaporise any DORC they touch and flood that
  DORC's own colour cluster. Descent drops to 0.45x while orbs are in hand.
- *QUESTION_RATE 0.28 / COIN_SHARE 0.62* → **0.55 / 0.80**, and never more than
  one Brain Freeze on the board at once.
- *Ball swap and HOLD* → **removed** (`function swap(){ /* removed */ }`). The
  HUD reads TERRITORY HIGH, not LIFETIME.
- *activeCount=5 static* → **colour unlocks are dynamic**, driven by
  `getTerritoryHigh` (which reads `score_events`, not `players`):
  `UNLOCK_FLOOR = 2500`, then teal / orange / pink at +0 / +1000 / +2000 over
  the region's best single run.
- *Live map polls `getEvents` every 4s* → **`getEvents` is dead code**. The page
  calls `getRecentScores`, shuffles, and fires one burst every 8–15s, paused
  when the tab is hidden. `score_events` is still written and no longer read
  except by `getTerritoryHigh`. The panel says ONLINE [REAL TIME]; it is a
  rotation. Real-time is wanted but deferred (see Open work).
- Line counts: REC Room `index.html` ~1,400 (not 964), the game ~3,142
  (not ~1,800).

## Running it

There is no build step, no bundler, no CI. Push to `main` and Vercel deploys.
Edit the committed HTML directly. Only npm dependency is
`@neondatabase/serverless`.

Chain: **GitHub → Vercel → Mindtickle Custom HTML widget (iframe) → browser.**

## The section system

Every page reads `?section=` and sets `data-section` on `<html>` *before* styles
apply. One rule hides every top-level block, then per-section rules re-show what
that view owns, matching the hide rule's specificity and ordered after it. Boot
code is gated the same way so four widgets don't each fetch the news.

| File | Sections |
|---|---|
| `SalesCommand/qlikmt-hero.html` | topbar, ticker, highlights, glossary, mobile |
| `SalesCommand/qlikmt-hero2.html` | calendar |
| `QlikRecRoom/index.html` | banner, game, play, scoreboard, board-mobile, launch, cartridges |

`hubs` and `certs` work through a second mechanism — `SECTION_CARDS` +
`data-card` — so adding a card section is a data entry, not new CSS.

**Never fork these files.** Adding a section is a visibility block at the END of
the stylesheet plus a `SHOW_*` flag.

## Mindtickle embedding — the constraints that drive everything

Travis's own notes (`Reference Material/Sun 0823326/Mindtickle iframe examples.txt`)
are the authority here. The essentials:

- **Iframes cannot self-size, and Mindtickle strips JS from the widget**, so a
  posted height has no receiver. Every height is a hand-measured constant.
  *Exception:* a section whose content is inherently proportional can use
  `aspect-ratio` — the game frame does (`7/4`), and it is the only one.
- **Widget media queries measure the page, not the iframe.** The iframe is
  ~100px narrower. Offset widget breakpoints upward: content restacking at 1023
  iframe px means a 1120 page-px breakpoint.
- **The mobile app crops every widget to ~200px** and adds an expand control
  that cannot be moved or restyled. Declare 200 and design for 200.
- **Expanding does not grow the iframe** — verified from screenshots: the
  content stays 200px with Mindtickle's white modal behind it. The codex note
  about "detecting the height jump to 822" did not reproduce. Do not build
  anything that depends on detecting expansion.
- **Android reports ~1080 CSS px where iOS reports ~408** for the same iframe,
  so width-based device detection is unreliable. Prefer Mindtickle's per-device
  widget visibility over anything the page tries to detect.
- Chrome's translator skips cross-origin iframes entirely.
- Mindtickle applies `word-break` to widget content; reset it.
- `scrolling="auto"` is needed for the expanded view. To avoid grey scrollbars,
  `html[data-section]` drops the `min-height:100vh` floor and hides the bar —
  scrolling still works, the chrome does not show.
- Two widgets with opposite visibility is the only way to reorder for mobile.

## Auth and score integrity

**Identity is a self-declared trigram**, deliberately disconnected from any Qlik
system. `lookupTrigram` reads `players` first, then falls back to `mt_roster`
(the Mindtickle roster export) to prefill territory and country. A mismatch
warns but does not gate. Entering someone else's trigram donates points to them.

**The session key is not in the repo.** `index.html` reads it from `?k=`, which
lives in the Mindtickle widget URL (admin is not public). Loaded without a key
the page still plays but cannot score, and says so via the orange **DORC
DETECTED** alert rather than failing silently.

`logScore` and `updateIdentity` accept `MT_SESSION_REF` (desktop) or
`MT_SESSION_REF_MOBILE` (mobile). **Each may hold a comma-separated list**,
which is what makes rotation safe — there is no way to change Vercel and the Mindtickle widget at the same
instant, because homepage custom-HTML widgets are *not* in Mindtickle's API
(checked against their docs). Rotate with an overlap:

```
1. Vercel: KEY = old,new   → redeploy
2. Mindtickle: widget → ?k=new
3. Vercel: KEY = new       → redeploy
```

**Score plausibility is tied to time played**, not a flat cap, so a genuine
fifteen-minute run is never rejected: `max = 5000 + (60 × durationSec)`. Plus a
10-second per-trigram cooldown. These are server-side and are the real
protection; client-side device detection would be theatre (one toggle in
devtools) and was deliberately not added.

## Gotchas that cost real time

- **`?section=play` had no reachable sign-in on a phone.** `#playBtn` sits in
  `.ph-online`, which is `display:none` under 1023px, and the game frame covers
  the viewport — so mobile players got PRACTICE MODE and banked nothing,
  silently. The gate now opens on arrival when a key is present.
- **The game has no touch handlers at all.** Aiming is `mousemove`, firing is
  `click`. It works on a phone because mobile browsers synthesise a `mousemove`
  at the tap point before the `click`. That means tap-to-aim-and-shoot works but
  there is **no drag-to-aim preview** — a real `touchmove` handler would be an
  upgrade, not a repair.
- **Neon:** a `TRUNCATE` in the SQL editor silently did nothing until wrapped in
  an explicit `BEGIN; … COMMIT;`. If the API still shows old data after a wipe,
  check the commit before hunting branches.
- `[hidden]` loses to any author `display` rule. `.mcard [hidden]{display:none
  !important}` exists for that reason.
- **Full screen paints ONLY the fullscreened element and its descendants.** Any
  modal that is a *sibling* of it still opens, still runs its JS, and is simply
  never drawn — so the click reads as "nothing happened", and the modal appears
  the instant you exit. This bit `?section=game`: `#playBtn` lives inside
  `.game-frame` so it stayed clickable, while `#loginGate`, `#mismatchModal` and
  `#dorcModal` are siblings, so signing in from full screen did nothing visible.
  Both pages now park their overlays inside the fullscreen element on
  `fullscreenchange` and restore them (parent *and* sibling position) on exit.
  Safe because each is `position:fixed` with no transformed ancestor, so it
  still lays out against the viewport and `overflow:hidden` does not clip it.
  **Anything new that overlays the game must be added to that list** —
  `OVERLAY_IDS` in `index.html`, `relocateDorc` in `mobile.html`.
- **ffmpeg drops WebM alpha silently, and the container tag lies about it.**
  VP8/VP9 alpha lives in an auxiliary stream; `ffprobe` reports the video stream
  as plain `yuv420p`, so a transparent video looks like an ordinary opaque one.
  ffmpeg's *native* decoder discards the alpha, and a re-encode then copies the
  `ALPHA_MODE=1` tag onto opaque output — so the file still claims transparency
  it no longer has, and renders with a black box. This ate the REC Room logo.
  Decode through `-c:v libvpx-vp9` (which exposes `yuva420p`) and encode with
  `-pix_fmt yuva420p -auto-alt-ref 0`.
  **Never trust a codec to preserve alpha — test it.** Composite a frame over
  red, again over blue, and diff. Identical means the alpha is gone. That check
  caught H.264 flattening the tool GIFs and would have caught the logo.
- **Landscape on a phone is forced by rotating the iframe, not by asking the
  OS.** `screen.orientation.lock()` does not exist in Safari, and rotation lock
  defeats the rest. `mobile.html` rotates `#gameFrame` 90° in CSS when the
  viewport is portrait. Rotate the **iframe**, never anything inside the game:
  the browser owns hit-testing through a transformed iframe and gives the inner
  document untransformed coordinates, so `frameToInternal` needs no changes.
  Rotate inside the game and you must rewrite the aim mapping.
- **`new Audio()` per sound effect puts a media control on the iOS lock screen
  and in the UI** — one per clip. SFX and voice go through the game's existing
  `AudioContext` instead, which has no media session. Decoded buffers are cached
  (there are 57 clips); do not go back to `<audio>` elements for one-shots.
- **Deployment weight is `.vercelignore`'s job, not the bin.** ~540MB of source
  masters and unreferenced media are kept in git and excluded from the CDN.
  Before adding a line, grep every html/js/json for the filename — a file that
  exists locally but is excluded is the nastiest failure mode there is: perfect
  on your machine, 404 in production.
- **Full screen is blocked inside the Mindtickle widget, and the feature test
  that catches it is `document.fullscreenEnabled` — not the method.** Inside the
  widget iframe `element.requestFullscreen` *exists*, so a `!!(...)` test passes
  and you ship a button that does nothing. Permissions Policy blocks the call
  because the host iframe has no `allow="fullscreen"`, and that attribute is on
  Mindtickle's side of the boundary — it cannot be added from here. Two things
  follow, and both cost a round trip to discover:
  1. Test `document.fullscreenEnabled`, which reports *permission*, not presence.
  2. **`requestFullscreen()` returns a Promise.** `try/catch` only catches a
     synchronous throw, so a rejection vanishes and the button sits there dead.
     Always `.catch()` it.
  The desktop button now falls back to `openInNewTab()` when blocked — the room
  at top level *can* go fullscreen — and labels itself `Full screen ↗` to say so.
- **Full screen and orientation cannot be forced on an iPhone.** Checked against
  the platforms, not assumed:

  | | Fullscreen API | `screen.orientation.lock` |
  |---|---|---|
  | Android Chrome | yes, from a gesture | yes, **only while fullscreen** |
  | iPadOS Safari | yes | no |
  | Desktop | yes | n/a |
  | **iPhone Safari** | **no** — only `<video>` | **no** |

  So `mobile.html` fullscreens *and* locks landscape automatically on Android.
  On iPhone there is nothing to call, and the answer is **Add to Home Screen** —
  standalone has no browser chrome at all. That is worth real screen, because
  **the game frame is 7:4 and a landscape phone is much wider than that, so it
  fits to HEIGHT**: every pixel of address bar costs 1.75 pixels of game width.
  Measured on an iPhone landscape viewport (844×390):

  | | usable height | game size | play area |
  |---|---|---|---|
  | Safari, bars showing | 280 | 490×280 | 137k px |
  | Safari, bars collapsed | 340 | 595×340 | 202k px |
  | **Installed (standalone)** | **390** | **683×390** | **266k px** |

  Installing is close to **double** the play area. The Play view keeps a
  **Full screen button on iPhone too** — it cannot call an API, so it opens the
  Add-to-Home-Screen walkthrough. A *missing* button reads as "not possible",
  which is worse than a button that explains the one route that works.
- **`window.open` from inside the Mindtickle app does not reach Safari.** It
  opens the app's own in-app browser, which inherits the host app's orientation
  — so the game is pinned to portrait however the phone is held. This is an
  iOS-level behaviour, not something the page can override. The escape is the
  `x-safari-https://` scheme, which the widget button now tries first (falling
  back to `window.open`, guarded on `visibilitychange` so a successful jump does
  not also open a second copy on return).
- **In-app browser vs real Safari is not detectable on iOS.**
  `SFSafariViewController` sends the same user-agent as Safari. Do not write
  copy that asserts which one the player is in — `mobile.html`'s play-view tip
  is worded to be true in both.
- **A syntax error in one `lib/` file takes down its whole namespace.** The
  routers `import` every action statically, so a parse failure in, say,
  `lib/recroom/logScore.js` means `/api/recroom/*` — leaderboard, lookup,
  everything — returns `FUNCTION_INVOCATION_FAILED`, not just scoring. This
  happened on 2026-08-24 (a merge duplicated a `.filter()` line, the first copy
  ending in `;`) and it was live. **Parse-check before pushing:**
  `for f in api/*.js lib/*/*.js; do node --check "$f"; done`, and the same for
  inline `<script>` blocks. Vercel does not fail the build on this.
- **`api/lookupTrigram.js` was deleted 2026-08-24** — a pre-router orphan with
  nothing in the repo calling it (the pages use `/api/recroom/lookupTrigram`),
  and it had been 500ing on its roster-prefill path. If some hand-edited
  Mindtickle widget turns out to call `/api/lookupTrigram`, it now 404s; restore
  it from history or add a `vercel.json` rewrite to the recroom action.

## ⚠ Live temporary state — check this first

- **`OPEN_SCORING` in `lib/recroom/logScore.js` disables the key gate.** Turned
  on 2026-08-25 for a demo. While true, anyone who knows the URL can POST a
  score. **It fails closed after `OPEN_UNTIL` (2026-08-27)** — if scoring starts
  returning 401 for no apparent reason, this is why. Set `OPEN_SCORING = false`
  to restore the gate, or move the date if the window needs extending.
  The plausibility ceiling and the cooldown are still enforced either way.
- **The underlying key mismatch is unfixed.** The 401 diagnostic reported
  `serverHasKeys: true`, so Vercel's env vars are correct and the Mindtickle
  widget URL carries the wrong `?k=`. Suspects: the `YOUR_DESKTOP_KEY`
  placeholder left in a pasted snippet, or a `+`/`#` in the key being mangled
  (`URLSearchParams` decodes `+` as a space; `#` truncates the URL).
- **`durationSec` is client-supplied and uncapped**, so `max = 5000 + 60 ×
  durationSec` authorises itself — claim an hour and you may post 221,000.
  If the key gate is removed permanently this must be capped first, or the
  ceiling bounds nothing.

## Open work

- ~~**A mobile mirror site.**~~ **Built 2026-08-24.** `QlikRecRoom/mobile.html` is
  now the whole REC Room, mobile-first — badge, play, scoreboard — over the same
  API and the same game. It is a second front end, not a reskin of `index.html`.

  **One file, two renders.** It checks `window.self !== window.top`:
  *framed* it is the Mindtickle widget (one card, one button, designed for the
  ~200px crop) and the button `window.open`s this same URL at top level with the
  key attached; *unframed* it is the room. That means **the Mindtickle widget URL
  never has to change** — the existing `mobile.html?k=…` widget keeps working and
  its button now lands on the full room instead of the desktop page.

  Notes for whoever touches it next:
  - Country list is a **copy** of the `COUNTRIES` literal in `index.html`. No
    build step and no shared JS file, so it is duplicated on purpose. If one
    changes, change both.
  - Identity lives in `localStorage['recroom.id']`, the key in `recroom.k`.
  - **On a trigram/territory mismatch the phone adopts the *stored* territory**
    and says where the points will land, rather than offering a relocate flow.
    `updateIdentity`'s key gate has since been brought in line with `logScore`
    (both vars, comma-list aware), so a mobile relocate is now *possible* — but
    the page still does not offer one, because `logScore`'s upsert never
    rewrites `territory` and a half-move is worse than no move. If you add it,
    call `updateIdentity` first and only then enter the room.
  - The rotate-to-landscape prompt is **dismissible**. A hard gate strands
    anyone playing with orientation lock on, because the phone reports portrait
    however they hold it.
  - **`manifest.json` has no `start_url`, on purpose.** Per spec a missing
    `start_url` defaults to the URL the app was installed *from*, which is how
    the `?k=` session key survives Add to Home Screen. It used to declare
    `./mobile.html`, which stripped the key — so an installed copy launched
    straight into practice mode and banked nothing. That mattered doubly on
    iPhone, where Add to Home Screen is the *only* route to true full screen, so
    "install it for full screen" and "your points stop counting" were the same
    instruction. Do not add `start_url` back without carrying the key another
    way. (iOS also gives a standalone app its own storage container, so the
    `localStorage` stash does not cross over — the install URL is the only
    reliable carrier. **Needs a device test.**)
  - Validated headlessly (JS parse, id/tag/CSS-brace checks, and a DOM shim that
    runs boot, sign-in, mismatch, no-key and board render against the live API).
    **Not yet rendered in a browser** — screenshot it on a real phone before
    trusting the layout.
- **Real-time map.** Wanted. Deferred because polling keeps Neon awake and burns
  the free tier. The answer is pub/sub (Ably or Pusher free tier): `logScore`
  publishes after the write, the room subscribes. Keep the rotation as filler for
  quiet periods, so the panel's REAL TIME label becomes true without the map
  going dead between plays.
- **Cartridge shelf** (`?section=cartridges`) is built but parked — Blitz live,
  three locked slots. It cannot drive the game frame because they are separate
  iframes with no postMessage bridge.
- **SCORM / Storyline wrap** for module completion write-back, and the Mindtickle
  API work behind it (badges on score achievements). Deliberately deferred; it
  must not influence game decisions now.
- Touch aiming with a visible trajectory guide.

## House style

Travis reacts to rendered output. Short corrective feedback means fix it now.
Surgical edits, never full-file rewrites. Validate before shipping — render or
screenshot to confirm visual changes, and check JS parses. Give honest tradeoff
analysis before building. Flag gaps rather than filling them with invention.
