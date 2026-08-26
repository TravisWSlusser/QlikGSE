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

### Verifying before you push — READ THIS FIRST

**There IS a Node, it is just not on PATH.** `node`, `npm`, `npx`, `python` and
`psql` all fail from the shell, which makes it look like there is no way to
parse-check anything. There is:

```
N="C:/Program Files/Adobe/Adobe Creative Cloud Experience/libs/node.exe"   # v24
for f in api/*.js lib/*/*.js; do "$N" --check "$f" || echo "FAIL $f"; done
```

`package.json` has `"type": "module"`, so `--check` parses `lib/` as ESM
correctly. For an inline `<script>`, strip the tags to a `.cjs` and check that:

```
awk '/<script[^>]*src=/{next} /<script/{i=1;next} /<\/script>/{i=0;print "";next} i' page.html > /tmp/x.cjs
"$N" --check /tmp/x.cjs
```

This matters more than it sounds. **A syntax error in one `lib/` file takes
down the entire namespace** (see Gotchas), and Vercel does not fail the build
on one.

**Do not substitute a hand-rolled checker.** On 2026-08-26 a whole session ran
on a homemade brace-balancer and the Windows JScript host because `node` was
assumed missing. Both lied, in ways that looked like real findings:

- The brace-balancer does not understand **regex literals**, so `/[",\n]/` and
  `/[&<>"']/g` read as unterminated strings. It reported FAIL on files that
  were perfectly valid, every time, and the only way to tell a real failure
  from a false one was to run it against `HEAD` and compare.
- **JScript is ES3.** It cannot parse `let`, arrow functions or template
  literals, *and* `new Date("2026-09-01T00:00:00")` returns `NaN` — so a
  simulation of the page's date logic silently compared against NaN, made every
  comparison false, and produced a confident, plausible, wrong answer that was
  reported to Travis as verified.

If a checker disagrees with `HEAD` in the same way on unmodified code, the
checker is what is broken. Use the real parser.

## The section system

Every page reads `?section=` and sets `data-section` on `<html>` *before* styles
apply. One rule hides every top-level block, then per-section rules re-show what
that view owns, matching the hide rule's specificity and ordered after it. Boot
code is gated the same way so four widgets don't each fetch the news.

| File | Sections |
|---|---|
| `SalesCommand/qlikmt-hero.html` | topbar, ticker, highlights, glossary, mobile + card sections: hubs, certs, comic, academy |
| `SalesCommand/qlikmt-hero2.html` | calendar |
| `QlikRecRoom/index.html` | banner, game, play, scoreboard, board-mobile, launch, cartridges |
| `SalesCommand/stellar.html` | banner, hero (+ `?compact=1` for the mobile widget) |

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

## The calendar — one source, three files

`SalesCommand/assets/calendar/events.json` is the source of truth. Both
`qlikmt-hero.html` (the key-date chips under the header rotator) and
`qlikmt-hero2.html` (the month calendar) fetch it and **replace `KEY_DATES`
wholesale** — `KEY_DATES.length = 0` then push. It is not a merge.

Two consequences people get wrong:

1. **`KEY_DATES` in each page is an OFFLINE FALLBACK, not data.** A successful
   fetch deletes whatever is in it. An entry that exists only in a fallback is
   invisible in production and appears *only* when the JSON 404s. Both Q3
   Certification dates were in that state until 2026-08-26.
2. **Edit all three, every time.** No build step, so they are kept in step by
   hand. The check that catches drift:

```
norm(){ grep -oE "date:'[0-9-]+'|\"date\": \"[0-9-]+\"" "$1" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort; }
norm SalesCommand/assets/calendar/events.json > /tmp/a
awk '/^let KEY_DATES = \[/,/^\];/' SalesCommand/qlikmt-hero.html | norm /dev/stdin > /tmp/b
diff /tmp/a /tmp/b
```

**Schema** is documented in the file's own `_comment`. `date` `category`
`month` `day` `title` `detail` `year`, optional `full`, `link`, `pin`.
**`full` and `link` are stored but NOTHING RENDERS THEM** — the Sept 3 session's
Zoom link is sitting in `link` unused. Do not tell anyone a link is on the page.

**`pin` costs one of only three chip slots** (`UE_SHOW = 3`) and bypasses the
past-date filter, so a pinned date that has gone by squats on the strip forever.
Pinning two dates leaves one slot for everything else.

**Past events** are dimmed via `.past` (`.ue-chip`, `.lc-date-chip`, `.cal-pill`,
`.cal-li`) and excluded from the calendar Spotlight entirely — that widget is a
recommendation, not a record. `isPastEvent()` is **duplicated in both pages** on
purpose; if one changes, change both.

**Never build a date with `new Date('2026-09-01')`.** It parses as UTC, so west
of Greenwich it lands on the evening of 31 Aug and events read as past a day
early — for a NAM-heavy audience, that is every event, every time. Build from
parts: `new Date(+y, +m-1, +d)`. The existing code uses the
`new Date(iso + 'T00:00:00')` form for the same reason.

## Auth and score integrity

**Identity is a self-declared trigram**, deliberately disconnected from any Qlik
system. `lookupTrigram` reads `players` first, then falls back to `mt_roster`
(the Mindtickle roster export) to prefill territory and country. A mismatch
warns but does not gate. Entering someone else's trigram donates points to them.

**⚠ THE KEY GATE IS OFF (2026-08-26, permanent until someone turns it back on).**
`REQUIRE_KEY = false` in both `lib/recroom/logScore.js` and
`lib/recroom/updateIdentity.js`, and `CAN_SCORE` is forced `true` in both
`QlikRecRoom/index.html` and `QlikRecRoom/mobile.html`. Anyone who knows the URL
can post a plausible score to any trigram. That is an accepted trade for an
internal leaderboard, made after a week in which the widget and the server
disagreed about the key and real players were told their runs did not count.

**Turning it back on is four edits and they must all land together**: two
`REQUIRE_KEY = true`, and both `CAN_SCORE` back to `SESSION_KEY.length > 0` /
`KEY.length > 0`. Server-only is the dangerous half-move — the pages would keep
letting people sign in and play while every write 401s. Client-only is the other
half-move: `index.html` only opens the sign-in gate when `CAN_SCORE`, so players
land silently in practice mode while the API would happily have taken the score.
Nothing was deleted to turn this off, only bypassed: `?k=` is still read, still
stored, still sent, and the env vars are still parsed.

**The session key is not in the repo.** `index.html` reads it from `?k=`, which
lives in the Mindtickle widget URL (admin is not public).

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
fifteen-minute run is never rejected:
`max = min(5000 + 60 × min(durationSec, 1800), 50000)`. Plus a 10-second
per-trigram cooldown. These are server-side and, with the key gate off, they are
now the *only* protection — so both caps matter:

- **`durationSec` is client-supplied**, and it is the input to the ceiling, so
  uncapped it authorises itself (claim an hour, post 221,000). `DURATION_CAP`
  of 1800s prices any run as at most 30 minutes. A longer genuine run is not
  rejected, just priced as 30 minutes.
- **`SCORE_ABSOLUTE_MAX` (50,000) cannot be argued with by anything in the
  request body.** ~12× the best score ever recorded (4,235). Raise it if real
  scores ever approach it.

Client-side device detection would be theatre (one toggle in devtools) and was
deliberately not added.

**Excluded players** — `lib/recroom/excluded.js` holds `EXCLUDED_TRIGRAMS`
(currently `TVO`, `LND`: the two people who build the thing). Applied at **read
time only**, as `trigram <> ALL(${EXCLUDED}::text[])`, in `getLeaderboard`
(all three queries), `getRecentScores`, `getTerritoryHigh` and `trend`.

Deliberately **not** applied in `lookupTrigram` (so an excluded player still
sees their own badge and total — that is how they keep tracking themselves) or
`exportData` (the CSV stays complete and gains an `excluded` column). Nothing in
the write path knows the list exists: scores still accumulate, so removing a
trigram brings them back with their real total, not from zero.

Two traps if you touch it:

- The filter must sit **inside** the `ROW_NUMBER()` subquery in the top-3 query.
  Filtering after ranking leaves a hole where the excluded player was — two
  names under a heading of three.
- `playerLifetime()` in `index.html` falls back to finding yourself on the
  leaderboard, which returns 0 for an excluded player. Sign-in now carries
  `lifetime` from `lookupTrigram` instead. Mobile already did this.

An empty `EXCLUDED` array makes `<> ALL('{}')` true for every row, so emptying
the list restores the old behaviour exactly — the filter cannot half-apply.

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
- **`perl -0pi` destroyed the UTF-8 in both hero files.** A one-line
  substitution run through it re-encoded *every* high byte in the file as
  Latin-1 — all 54 em-dashes in `qlikmt-hero.html` and 23 in `qlikmt-hero2.html`
  became `C3 A2 C2 80 C2 94` mojibake, thousands of lines away from the text
  being edited. Perl without `use utf8`/`binmode` treats the file as bytes and
  re-encodes on output. **Use the editor, or a tool that is explicitly UTF-8
  aware.** The check that caught it before commit:

  ```
  od -An -tx1 -v FILE | tr -s ' ' '\n' | grep -v '^$' | tr '\n' ' ' \
    | grep -o 'c3 a2 c2 80' | wc -l      # want 0
  ```

  Count `e2 80 94` against `HEAD` too — a *drop* in correct em-dashes is the
  tell. `git diff` will not make this obvious and PowerShell's `-Encoding UTF8`
  decodes the damage back into plausible-looking characters.
- **A view built once at load will silently serve stale data forever.**
  `calByDate` in `qlikmt-hero2.html` was indexed a single time from `KEY_DATES`
  while that still held the offline fallback. The fetch replaces `KEY_DATES` and
  calls `renderCal()`, but `renderCal` read the stale index — so the month grid
  showed fallback data for the life of the page while the list underneath it
  (which filters `KEY_DATES` directly) showed the live JSON. Two views of the
  same data, on the same screen, disagreeing. It was invisible only because the
  fallback happened to match. When something is refreshed asynchronously, **every
  derived structure has to be rebuilt in the render, not at module scope.**
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
- **Duplicated handlers: check which copy the caller actually hits.**
  `api/status.js` was a byte-for-byte duplicate of `lib/command/status.js` —
  same fetchers, same service list, its own cache. Adding Mindtickle to the lib
  copy changed `/api/command/status` and left `/api/status` untouched, which is
  the path every page actually calls. Nine minutes were spent blaming a
  five-minute cache. `api/status.js` is now a thin re-export; one
  implementation.
  **Still duplicated:** `lib/recroom/lookupTrigram.js` and
  `lib/blitz/lookupTrigram.js` are identical and both routed. Fix one and the
  other silently keeps the old behaviour. Worth collapsing to a shared module.
- **Verify structural changes structurally.** A `grep`/`.test()` for a service
  name passed on an unrelated `names` array while the actual fetch call was
  missing, and the change was reported as done. If two lists must correspond,
  compare them to *each other* — the fetch array and `names` in
  `lib/command/status.js` are positional, so a mismatch mislabels a failed
  fetch with the wrong service.
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

## Maintenance mode — the runbook

Closing the room takes one SQL statement and no deploy. That is the whole
point: an env var would need a redeploy each way, which you cannot do while
mid-update.

**One-time setup** (safe to re-run):

```sql
CREATE TABLE IF NOT EXISTS app_state (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO app_state (key, value) VALUES
  ('maintenance',         'off'),
  ('maintenance_message', 'The REC Room is closed for a short update.'),
  ('maintenance_eta',     '')
ON CONFLICT (key) DO NOTHING;
```

**Close the room** — wrap it, or the Neon editor may not commit (see Gotchas):

```sql
BEGIN;
UPDATE app_state SET value = 'on', updated_at = now() WHERE key = 'maintenance';
UPDATE app_state SET value = 'Back by 3pm ET — banking scores and shipping an update.'
  WHERE key = 'maintenance_message';
UPDATE app_state SET value = 'Back by 3pm ET' WHERE key = 'maintenance_eta';
COMMIT;
```

**Reopen:**

```sql
BEGIN;
UPDATE app_state SET value = 'off', updated_at = now() WHERE key = 'maintenance';
COMMIT;
```

**What closing actually does:**

- Desktop and mobile show a full-screen BE RIGHT BACK. It is not dismissible.
- Any run in progress is abandoned (`BLITZ_ABANDON`), so nothing keeps playing
  behind the screen.
- `logScore` returns **503** — so a session that was already open cannot land a
  straggler write while you are migrating or wiping. This is the bit that makes
  it safe to run DDL.
- Pages poll every **45s**, and again whenever a tab is refocused. So expect up
  to a minute for everyone to fall in, and the same to come back. Nobody has to
  refresh.

**It fails OPEN, everywhere and on purpose.** Missing table, unreachable
database, request timeout — all of them mean "stay online". Only an explicit
`'on'` read back from a healthy query closes anything, because a switch that
can close the room by breaking is worse than having no switch.

## Where we left off — 26 Aug 2026

Last session ended here. Everything below is pushed, deployed and verified live
unless it says otherwise.

**Shipped that day:** calendar refresh (Huw's changes, the Q3 cert dates, the
three Sparks sessions), zero-score rows dropped from Recent Activity, the key
gate removed permanently with `durationSec` capped, TVO/LND excluded from the
public boards, the calendar grid's stale-index bug fixed, and past events dimmed
everywhere plus excluded from the Spotlight.

**Travis was about to announce the REC Room** to the Sales Enablement Slack
(20+ people, the whole enablement org). Announcement copy was drafted and is in
that conversation, not in the repo.

### Open — needs Travis, cannot be done from here

- **`QQQ` and `ZZZ` are still on the live leaderboard.** Test rows, both written
  by Claude. There is no DB access from this environment (no `psql`, no
  `DATABASE_URL`, no Vercel CLI), so this needs running in the Neon editor —
  **wrapped in `BEGIN; … COMMIT;`** or the editor may not commit it:

  ```sql
  BEGIN;
  DELETE FROM score_events WHERE trigram IN ('QQQ','ZZZ');
  DELETE FROM players      WHERE trigram IN ('QQQ','ZZZ');
  COMMIT;
  ```

- **`CREATE TABLE app_state`** has still never been run, so maintenance mode has
  no table behind it. It fails open, so nothing is broken — but the switch does
  not work yet. DDL is in the **Maintenance mode** runbook above.

### Open — decisions Travis has not made

- **Unpin the 14 Sept Q3 deadline?** It permanently holds one of three chip
  slots. Unpinned, the strip reads SEP 1 / SEP 3 / SEP 8 — all three Sparks,
  which is what he said he wanted the chips to show. Pinned (current), it reads
  SEP 1 / SEP 3 / SEP 14. Asked twice, not answered; left pinned because losing
  a real deadline off the strip is a genuine cost.
- **What timezone are the Sparks sessions?** All three are "10:00-11:00 AM" with
  no zone, because none was given. For a NAM/LATAM/EMEA/APAC audience that is
  actively misleading. The times live in `detail`; the schema has no time field.
- **Render the Zoom link?** The 3 Sept session's link is stored in `link` and
  nothing displays it. Wiring a "Join" button into the calendar modal would
  cover every future session.
- **A staff-only leaderboard** so TVO and LND can still compete with each other,
  behind `EXPORT_KEY`. Offered, not requested.

### Known-imperfect, flagged not fixed

- `lib/recroom/lookupTrigram.js` and `lib/blitz/lookupTrigram.js` are still
  identical duplicates, both routed. Fix one and the other keeps the old
  behaviour.
- The Spotlight is month-scoped, so with past events now excluded it reads
  "Nothing more scheduled this month" for the rest of August. Correct, but it
  will look empty until someone pages to September. Falling back to the next
  upcoming events across months would fix it — the date labels in that widget
  derive from the displayed month rather than the event, so they would need
  fixing first.
- Two of the three dates relayed second-hand from Huw turned out not to be real
  sessions (Competitive Compass, Assistant in Action). **Check for an invite
  before putting a relayed date on a page the whole org reads.**
- `CAN_SCORE` is hardcoded `true` in both room pages. Intentional (see **Auth
  and score integrity**) but it is a lie the moment `REQUIRE_KEY` goes back on.

## ⚠ Live temporary state — check this first

- ~~**`OPEN_SCORING`**~~ **Gone 2026-08-26.** The dated bypass was replaced by
  `REQUIRE_KEY = false` — a permanent, undated off switch. See **Auth and score
  integrity** for what that means and the four edits that reverse it. There is
  no longer an expiry that will silently close scoring on a date nobody
  remembers, which was itself a hazard: the original `OPEN_UNTIL` would have
  shut scoring off at 8pm ET on the evening the game was announced to the org.
- **The key mismatch was never diagnosed, and now cannot be from here.** The
  401 diagnostic said `serverHasKeys: true`, so Vercel had keys and the widget
  `?k=` disagreed. The `+`/`#` mangling theory was **disproved** on 2026-08-26:
  the actual widget key (`qgse-d-oAMfNDco…`) contains neither. It was a plain
  value mismatch. The tolerance for trimmed / space→`+` keys was kept anyway —
  it costs nothing and kills that failure mode permanently — but **it was not
  the cause**, and a future debugger should not read it as evidence that it was.
  A `#` in a key truncates the URL before the request is made and cannot be
  repaired server-side, so **issue alphanumeric keys only**.
- **Testing a key costs nothing — use `updateIdentity`, not `logScore`.** It has
  no `OPEN_SCORING` bypass (so it tests the real gate even while scoring is
  open) and it validates the trigram *after* the key check, with no write on
  the failure path. POST a deliberately invalid trigram: `401` means the key is
  wrong, `400 Bad trigram` means the key is right and nothing was written.

  ```
  curl -s -X POST https://qlik-gse.vercel.app/api/recroom/updateIdentity \
    -H "Content-Type: application/json" \
    -d '{"key":"<KEY>","trigram":"1","territory":"NAM"}' -w "\n%{http_code}\n"
  ```

  This is the technique to reach for generally: **find the validation that runs
  just after the thing you want to test and fail it deliberately.** Two test
  rows are on the live leaderboard because this was not done.
- ~~**`durationSec` is client-supplied and uncapped**~~ **Capped 2026-08-26**,
  in the same change that removed the key gate — which is exactly the condition
  this entry said had to be met first. `DURATION_CAP = 1800` plus
  `SCORE_ABSOLUTE_MAX = 50000`. See **Auth and score integrity**.

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
