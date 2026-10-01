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

**Excluded players** — `lib/excluded.js` holds `EXCLUDED_TRIGRAMS` (currently
`TVO`, `LND`: the two people who build the thing). Applied at **read time only**,
as `trigram <> ALL(${EXCLUDED}::text[])`.

It lives at `lib/` root, **not inside a namespace**, and that is deliberate.
It shipped in `lib/recroom/` on 2026-08-26 and the game's own leaderboard was
missed — `/api/blitz/getScores` feeds the game-over arcade table from the same
`players` table and inherits nothing from `/api/recroom`, so for a day the game
showed both excluded players at the top of NAM while the REC Room scoreboard
beside it correctly did not. **The two namespaces share a database and share
nothing else. A policy applied to one is not applied to the other.**

Currently filtered — if you add a player-listing endpoint in *either* namespace,
add it here:

| File | What it feeds |
|---|---|
| `lib/recroom/getLeaderboard.js` | standings, top 3/territory, game masters (3 queries) |
| `lib/recroom/getRecentScores.js` | activity feed + map bursts |
| `lib/recroom/getTerritoryHigh.js` | colour-unlock bar |
| `lib/recroom/trend.js` | territory graph |
| `lib/recroom/getEvents.js` | dead code, filtered pre-emptively — the real-time map would revive it |
| `lib/blitz/getScores.js` | **the game's own arcade table** |

Correctly **not** filtered: both `lookupTrigram`s and `logScore` /
`updateIdentity` (single-trigram reads and the write path), plus `exportData`.

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
  (there are 72 clips); do not go back to `<audio>` elements for one-shots.
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

## CAPCOM — `CAPCOM/` + `/api/admin/*` (added 28 Aug 2026)

**The name is an acronym, chosen by Travis (updated 3 Sep 2026, the
"players" angle retired): Content, Analytics & Planning —
Command Operations Module.** The CAP is the app's own three nav pillars; the
COM carries the Apollo nod (the Command Module was the capsule Mission
Control's CAPCOM talked to — and this app is the one voice authorized to
change what Mission Control says). Keep the expansion intact on the gate.

The manager control app the hero comment always promised. A BRUCE-style SPA
(hash-routed, `h()` hyperscript, `api/ui/util/charts` + one file per view in
`js/views/`) served at `/CAPCOM/` (né `/ControlRoom/` — a rewrite keeps the old URL working; localStorage keys renamed `capcom.*`, so anyone who signed in before the rename pastes their key once more) over a fourth API
namespace: `api/admin.js` → `lib/admin/*`, added to `vercel.json`'s rewrites.

**Mobile (29 Aug 2026):** no longer desktop-only. Under 880px the
sidebar becomes an off-canvas drawer behind a fixed topbar burger
(`.mtop`/`.mback` in index.html; `body.nav-open` toggled in `app.js`,
cleared by `draw()` so navigating closes the drawer), `main` tightens,
and the existing grid collapses do the rest — every view fits 375px
with no horizontal scroll. Touch can't right-click (iOS never fires
`contextmenu`), so every board item wears a ⋯ chip — created in
`makeInteractive`, shown only under `@media (pointer:coarse)` — that
opens the same menu; its pointerdown stops propagation so tapping it
can't start a hold-drag or complete a yarn tie. Media queries here
measure the real page (no Mindtickle iframe offsets — CAPCOM is opened
directly).

**Branded per the Qlik Guidelines (10/01/24 PDF, in Travis's Reference
Material):** Deep Blue `#19426C` / the Mission Control navy family, Ocean
`#006580`, Sky `#10CFC9`, Green `#009845` (the SE typemark green — UI accent
only, never a data mark), Gray `#54565A`, Inter throughout. Light/dark via
`data-theme` on `<html>` (toggle in the sidebar, persisted as
`controlroom.theme`, set pre-paint by an inline snippet, dark default = the
Mission Control look). Every color is a CSS custom property — style against
the tokens or one theme breaks. The SE typemark SVGs live in
`ControlRoom/assets/` (white for dark, color for light — CSS swaps them).
Chart marks are per-theme tokens validated with the dataviz six-checks
script against their actual surfaces: dark `#0AA49E` on `#11304D`, light
`#007396` on `#FFFFFF` — plain Sky/Ocean fail those checks, so don't "fix"
the marks back to brand hexes without re-validating.

**Nav is grouped by app** — Mission Control (Calendar, Hero Banners,
Stellar-Seller — the two banner boards are separate entries into one
param-driven view), REC Room (Dashboard, Players, Questions, Maintenance),
System (Access & Setup). Maintenance sits under REC Room because it closes
the room; it still requires the `system` scope.

**Access is scoped keys, failing closed.** `ADMIN_KEY` env var (comma-list,
master, all scopes) plus an `admin_keys` table of minted keys with per-key
scope arrays — `calendar`, `banners`, `content`, `analytics`, `system`. An SME
key with only `content` sees the question banks and nothing else; the nav
filters itself from `whoami`. Keys travel in the `x-admin-key` header, never a
URL; minted keys are alphanumeric only (the `#`/`+` lessons); the full value is
shown exactly once at creation and masked forever after. `lib/admin/auth.js`
is the whole gate — every action calls `requireScope`, the router adds nothing.

**Calendar and banners moved to Neon.** Tables `events` + `event_categories`
feed `/api/command/events` in exactly the old `events.json` shape (`month`/
`day` derived server-side, same casing rules); table `banners` feeds
`/api/command/banners?board=highlights|stellar`. Both hero pages now fetch
those endpoints; **the hardcoded `KEY_DATES`/`HIGHLIGHTS`/`STELLAR_POSTS`
literals are offline fallbacks only** — an empty or errored feed leaves them
rendering, which means an unmigrated database changes nothing on the live
site. The HIGHLIGHTS build in `qlikmt-hero.html` was refactored into a
rebuildable `buildHl()` (the calByDate lesson: everything derived from the
array rebuilds inside it, and the minHeight floor resets on rebuild).
`assets/calendar/events.json` still exists but is no longer fetched by any
page — the Control Room is the editor now; do not hand-edit the JSON and
expect it to show up.

**Write-path rules the endpoints enforce** (so the editor cannot break the
pages): banner titles/bodies are sanitised on SAVE to the whitelist the
rotators were designed around (`<span class="ac">`, b/i/em/strong/br — nothing
else, no attributes); the last active banner on a board cannot be retired (the
page would silently fall back to stale hardcoded copy); glossary terms are
unique case-insensitively (checkTerm scores by text); question banks refuse to
drop below the game's floors (getTerms needs ~30 active terms for its
distractor pool); every delete anywhere is `active=false`, restorable, never a
row removal. Banner images upload to **Vercel Blob** (`uploadImage`, base64 in
JSON, 3MB cap, magic-byte checked — needs `BLOB_READ_WRITE_TOKEN`).

**The dashboard finally reads what logScore always wrote:** the per-stream
counters (`q_*`/`c_*`/`t_*`) and `score_events`. `lib/admin/analytics.js` is
one payload — totals, per-territory, stream accuracy, 30-day daily series,
top-50, recent runs, score distribution. It deliberately does NOT call
`/api/recroom/trend` (a GET that manufactures snapshot rows every ~55 min —
polling it from a dashboard would fabricate history). TVO/LND are INCLUDED
here and flagged, per the exportData precedent.

**Maintenance mode finally has its table and a switch.** `migrate` (system
scope, idempotent, seeds from the shipped literals only into empty tables)
creates `app_state` per the runbook; the System view closes/reopens the room.
The read side still fails open everywhere.

**Setup is self-announcing now (1 Sep):** `lib/admin/schemaVersion.js`
holds `SCHEMA_VERSION`; migrate stamps it into `app_state` on success;
whoami compares stamp vs code and returns `setup_pending` (an
unreadable stamp counts as pending). When it's pending, CAPCOM shows a
bottom banner with a one-click **Update now** — visible only to the
leadership circle: system-scope keys OR a member session that LEADS an
active team (`project_teams.leader_id`); migrate itself accepts that
same circle. **RULE: any change that adds DDL or seeds to migrate.js
MUST bump SCHEMA_VERSION by one in the same commit** — that bump is
what makes the banner appear after the deploy; forget it and the
feature ships with silently-missing tables again.

**First-run order matters:** set `ADMIN_KEY` in Vercel → create the Blob store
→ deploy → open `/CAPCOM/`, sign in with the master key → run Setup. Until
Setup runs, both public feeds return empty and the pages keep their fallbacks —
the rollout is zero-risk by construction. **Re-run Setup after pulling new
CAPCOM features** — it is idempotent and later features add tables/columns
(admin_log, app_secrets, the per-question counters).

**Home** (`views/home.js`, the landing route) — scope-filtered quick actions
(deep links like `#calendar/new` open the target view with its editor up;
each view rewrites the hash back so a redraw doesn't re-open it), a rebuild
of the Mission Control calendar widget from the PUBLIC feed, the change
feed, latest scores, and most-missed questions.

**The change feed** — every `/api/admin` write calls `logChange` (from
`lib/admin/log.js`, fire-and-forget into `admin_log`), attributed to the key
LABEL. New write actions must call it too.

**Per-question stats** — `attempted`/`correct` columns on all three question
tables, bumped non-fatally by the game's `check*` endpoints. **Counting
started 28 Aug 2026; there is no per-question data from before.**
`questionStats` (analytics OR content — `requireScope` accepts an array) is
the read; the Home card ignores rows under 5 answers.

**Keys & Services** (`lib/secrets.js` at lib root — both namespaces read it):
runtime-editable secrets in `app_secrets`, resolution row → env var → '',
60s cache per warm lambda. Managed: the two MT session keys, EXPORT_KEY,
the three news/market API keys, NOTIFY_EMAIL. **Env-only forever (the trust
root): DATABASE_URL, BLOB_READ_WRITE_TOKEN, ADMIN_KEY, ULTRA_ADMIN_KEY,
RESEND_API_KEY.** ULTRA_ADMIN_KEY is Travis's break-glass master key —
checked before and independently of ADMIN_KEY so no rotation can lock him
out; only he knows the value (deliberately never generated or recorded by
Claude); its edits are labeled "ultra" in the change feed.
Consumers (logScore, updateIdentity, exportData, news, market) go through
`getSecret()`. Changes email NOTIFY_EMAIL via Resend when RESEND_API_KEY is
set — the mail includes the FULL new value at Travis's request
(`INCLUDE_VALUE` in `lib/admin/notify.js` flips that); the change feed only
ever stores the masked form, and `list` never returns full values at all.

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

## The boot veil (2 Sep 2026)

Travis's screen recording showed the widgets loading "jittery and
glitchy": ~3s of blank white iframes, then cards popping in piecemeal
with fonts swapping and entrance motion firing at different moments.
All three SalesCommand pages (hero, hero2, stellar) now assemble
behind a veil: `html.js body{opacity:0}` (the `js` class is set by the
first inline script, so no-JS never blanks a widget) and a reveal
snippet before `</body>` adds `.booted` (opacity 1, .45s fade) on
fonts.ready / window load / a hard 1100ms timeout — whichever lands
first. **The reveal must NOT wrap the class-add in
requestAnimationFrame** — rAF never fires in hidden/backgrounded
frames and the veil would simply never lift there; plain
classList.add still transitions.

## Mobile widgets render LIGHT (2 Sep 2026)

Per Travis, everything in the Mindtickle MOBILE app is light: the
Mission Control card already was; now `stellar.html` forces
`data-theme=light` whenever `?compact=1` is set (compact IS the mobile
app — both the Systems Watch banner and the hero rotator widgets ask
for it by name), and `QlikRecRoom/mobile.html`'s framed installer card
went from the dark continuity gradient to the same white card
treatment (the continuity argument flipped when the rotator above it
went light). Also fixed from a live iOS screenshot: the hero mobile
card's Expand-words/kicker overlap (≤520px keeps only the arrow) and
the invisible reverse logo on the white card (CSS-swapped color
variant). iOS iframes report ~408 CSS px; Android ~1080.

## The Enablement News Feed (1 Sep 2026)

`/api/command/inspiration` — public, keyless: aggregates a CURATED
list of reputable L&D/enablement RSS feeds (each verified live 1 Sep
2026; the list is `FEEDS` in `lib/command/inspiration.js`) and serves
only items matching the two themes (AI_RE / SE_RE regexes). Karl Kapp
(Travis studied under him) skips the theme gate so all his posts are
in the stream — but with NO special display treatment: Travis
explicitly wants a flat feed, no emphasis on anything, so items sort
purely by date and wear only their theme chips. Do not re-add badges
or floating. No deps: RSS/Atom parsed with regexes (CDATA/entity-tolerant),
6.5s abort per fetch, per-source cap 4, total 30. Caching copies
news.js's DB-row pattern (api_cache key 'inspiration', TTL 180min,
stale to 48h, never cache an empty result) — read news.js's header for
why edge caching alone fails per-region. The neon import is LAZY so
the module runs standalone under plain node for testing (no DB = no
cache, never an error). CAPCOM Home renders it as the "Enablement
News" card (right column; a failed feed clears the card quietly, like
the hotlinks bar). Dead feeds checked and excluded: ATD, Learning
Guild, Cathy Moore, Tim Slade, Articulate community. Highspot has a
live feed but is a Mindtickle competitor — Travis's call, left out.

## The Projects tracker (1 Sep 2026)

Sales Enablement's project board, in CAPCOM: nav group **Projects** →
Project Board (`views/projects.js`) + Insights & Calendar
(`views/projectsInsights.js`), over `lib/admin/projects.js` (lifecycle,
diary, milestones, review — 10 ops) and `lib/admin/projectsAdmin.js`
(managed teams + statuses). New scope **`projects`**; both nav routes
are `scope:null` on purpose — **reads are open to every key holder
(visibility is the product), writes gate on the scope**, and the views
hide edit controls without it. Home gets a compact at-a-glance card
(overdue first, then soonest due — the server's order).

**The accountability mechanic** (the whole point — enforced in
`lib/admin/projects.js`, the UI is a courtesy): every project is born
with a status and a `phase_due` date; every status change declares a
new date. Overdue is COMPUTED, never stored (`phase_due < todayIso()`
anchored to America/New_York; the due day itself is not overdue; dates
are date-only ISO strings compared lexically — never `new Date(iso)`).
An overdue project's next `status` or `extend` is 409'd unless it
carries a ≥10-char written note — `extend` on an overdue project files
the `overdue_note` diary entry and moves the date. `project_log` is
APPEND-ONLY (no active column, no edit/delete ops exist) — kinds:
created, status_change, overdue_note, due_change, update, milestone.
`{op:'review', from, to}` is management's quarter view, grouped per
project on the Insights page.

Teams and statuses are managed lists (retire refused while active
projects hold them; the last one is protected; retired rows still come
back in `list` so history renders). Status colors are palette KEYS
(violet/teal/amber/rose/blue/orange/sky) mapped to `--ps-*` tokens in
app.css — **both themes six-checks validated in that adjacency order
against the real card surfaces** (dark on #11304D, light on #fff);
`--overdue` is a status color, always paired with the OVERDUE label.
`charts.js` gained `donut()` and `gantt()` (SVG, shared #viz-tip,
colorVar = token names so themes just work; the Gantt scrolls in
`.gantt-wrap` — the one sanctioned horizontal scroll). Gantt segments
are derived client-side from the range's created/status_change entries.

The projects calendar (phase deadlines + milestones) shares zero data
with Mission Control's events. **Re-run Setup** (five new tables, five
seeded statuses in Travis's ladder order, one seed team) and grant
`projects` to the keys that should post — masters have it already.

## Team members & tagging (1 Sep 2026 — phase 1 of member access)

`team_members` registry (name, optional REC Room trigram — unique among
active, uppercased, 3 letters — team, title) + `project_members` tags,
both in migrate (**re-run Setup**). `lib/admin/members.js`: save /
retire / tag / untag, all 'projects'-scoped; the registry and active
tags ride back on `projects {op:'list'}` (sub-wrapped for pre-Setup) so
the Board renders everything from one call. Board UI: a Members manager
beside Teams/Statuses; tagging lives in the project Edit dialog (chips
✕ + a select, ops apply IMMEDIATELY, unlike the field edits around
them); the People column shows member chips first, free text is
demoted to "Guests / externals". Clicking any member chip opens their
person card: role · team · trigram, every project they're tagged on
with status/due/overdue, retired ones dimmed. Tags and untags write the
project diary.

**Phase 2 — member access codes (SHIPPED 1 Sep 2026).** A member signs
in with `TRI:code` (the gate's second half composes it; it travels as
the ordinary x-admin-key). `identify()` in auth.js checks it LAST —
after ultra/master/table keys, inside the same fail-closed envelope —
against `team_members.code_hash` (scrypt(code, salt), helpers
`makeSalt/hashCode/verifyCode` in auth.js, timing-safe compare; ~25ms
a verify; NEVER stored, logged, or echoed as plaintext). A member
session is `{label: real name, scopes: [], member: {id, name,
trigram}}`: every `requireScope(null)` read and the Community Board
admit it (writes there are signed with typed names anyway), the nav
collapses to Home + Projects, and `lib/admin/projects.js` additionally
admits `status/extend/note/saveMilestone/deleteMilestone` via
`memberCan()` — a live check that the member is TAGGED on that project
— while save/retire/tagging/managers stay 'projects'-scope-only. The
Board mirrors this honestly (Status/Extend render only on tagged rows
for a member).

**Claiming** (`lib/admin/memberClaim.js`, the one deliberately
unauthenticated admin action): "First time? Claim your member access"
on the gate → trigram + chosen code (8–64 chars) → works only for an
ACTIVE registry row with that trigram and NO code yet (Travis's
tag-first rule); already-claimed 409s. The accepted residual risk —
squatting a colleague's UNCLAIMED access — is visible in the change
feed and reversible via the Members manager's **Reset code** (op
`resetCode`, clears hash so they re-claim). `claimed` rides back on
the registry rows in projects `list`. Members also carry an optional
`email` (validated loosely, lowercased, shown as a mailto on the person
card), and the Board shows a how-to hint when the registry is empty —
the "where do I add people?" question came up within the hour. Re-run
Setup for the credential + email columns.

**CAPCOM is installable (2 Sep):** `CAPCOM/manifest.json`
(standalone, scope+start_url `/CAPCOM/`, navy theme) + apple metas and
icons (`assets/capcom-{512,192,180}.png`, ffmpeg-generated placeholders
— Travis owns the real art). Android: browser menu → Install app /
Add to Home screen; iPhone: Share → Add to Home Screen. No service
worker on purpose — an admin app must never serve stale cached data.
Remember the REC Room lesson: an installed iOS app has its OWN storage
container, so each person signs in once inside the installed copy
(their key/member code then persists there).

**People leaders (2 Sep, v2):** members carry `is_leader` (the
declaration — enablement has several) and `manager_id` (reports-to,
validated server-side: must be an active declared leader, never self;
stepping down as leader releases your reports' lines). The edit form
gains the checkbox + a Reports-to select of declared leaders. The
Staff tab nests same-team reports under their leader (`.cat-report`
indent); cross-team reports stay in their own column with "reports to
NAME" in the detail line. SCHEMA_VERSION bumped to 2 — the update
banner's first real firing.

**Staff tab (2 Sep):** the registry graduated from a dialog to a page —
nav route `projects/staff` (`views/staff.js`, scope null; edit controls
gate on 'projects'). Teams as columns, leaders starred, Unassigned and
(admins only) Retired buckets with restore; right-click any person for
Edit/Reset code/Retire (⋯ chip on touch); + Add New and the Teams
manager in the header. The Board's Members button became a link here;
`membersDialog` in projects.js is now unused-but-exported. The deploy
notes system also landed: `DEPLOY_NOTES` in schemaVersion.js (bump +
note in the same commit), a caret on the update banner listing what the
pending update adds, and a sidebar version chip (`ver-chip`) opening
"What is deployed" for any key holder.

**Catalog pass (1 Sep, later):** the Members dialog is now the **Team
Member Catalog** — a read-only list (+ Add New up top); actions
(Edit…/Reset access code/Retire) live on RIGHT-CLICK (`pctx`, a second
context-menu element — `#pctx-menu` shares `#ctx-menu`'s CSS; touch
gets the ⋯ chip via the coarse-pointer rule). Editing happens in a
proper form modal. Teams carry a **leader_id** (picked in the Teams
manager, validated against active members; `project_teams` SELECT is
`SELECT *` on purpose so the pre-Setup column gap can't break the
board). The Insights page gained a **Team Member Catalog card**: teams
as columns in sort order, the leader starred on top, an Unassigned
bucket, every row opening the person card (`historyDialog` is now
exported from views/projects.js). Re-run Setup for leader_id.

## Community Board — yarn, sounds, and the rename (29 Aug 2026)

The Corkboard is now titled **The Community Board** (UI string only — CSS
classes, localStorage keys, and the API stay `cork`/`stickies`;
renaming plumbing buys nothing).

**Yarn** ties two items on a board together with a colored string —
right-click → *Tie yarn…* → pick a color (red/orange/teal/purple/white)
→ click the other item. Strings are shared state in a new `sticky_yarn`
table (**re-run Setup in CAPCOM's System view to create it** — until
then tying fails with the usual "has Setup been run?" and the board
otherwise works, because `list` wraps its yarn query in its own
try/catch). Server ops on `stickies`: `tie` (dup-checked both
directions, both ends must be live on the board), `yarn_color`, `cut`
(soft delete); tie/cut hit the change feed. The client draws the
strings on an SVG `.yarn-layer` over the cork — sagging quadratics with
pin dots, `pointer-events:none` so the wall stays fully interactive —
and re-aims them live during drags (`redrawYarn`, rebound per render).
Right-click → *Yarn…* (only shown when strings touch the item) opens a
manager: recolor swatches and Cut per string, acting in place without a
board reload. Esc or clicking off the wall puts an untied string away.
One trap already hit while testing: the context menu clamps to the
viewport bottom, so its ITEM POSITIONS SHIFT when the entry count
changes — never reuse menu coordinates across opens.

**Light board + bookmarks (29 Aug, same day):** in light theme the cork
swaps to `assets/cork-light.jpg` — the SAME scan untinted, cut fresh
from Travis's original (`Reference Material/Fri 082826/CorkBoard_BG.jpeg`,
ffmpeg scale to 1200px) — with a warm wood frame. **Bookmarks** are a
third item kind: a manila folder (`.bkm`, pure CSS) wearing the link's
title; `message` = title, new `link_url` column (**re-run Setup**),
http(s)-validated both ends. A clean tap opens the link in a new tab
(`onTap` in makeInteractive — gated on `armed`, so the ⋯ chip's
stopped-propagation pointerup can't trigger it); hold still drags;
they take reactions and yarn exactly like notes (the server already
allowed it — reactions only reject stickers). The tie-mode click-away
canceller must list every item class — `.note,.stk,.bkm` — or tying to
the new kind silently cancels; that bug shipped for about five minutes.

**Yarn anchors (1 Sep):** strings no longer skewer item centers. A tie
stores WHERE it was pinned on each item — 0..1 fractions of the box
(`from_ax/from_ay/to_ax/to_ay` on sticky_yarn, nullable; re-run Setup):
the from-end is the click that opened the item's menu (`menuAnchor`,
captured on contextmenu and the ⋯ chip), the to-end is the
tie-completing click. Yarn WITHOUT anchors (legacy rows) clips to the
item's EDGE along the string's direction (`edgePoint` in redrawYarn).
Anchors are bounding-box fractions, so heavy rotation drifts them
slightly — accepted.

**Signatures (1 Sep):** EVERYTHING on the board is now signed with a
typed real name — notes and bookmarks joined stickers/reactions in
requiring `poster_name` (2–40 chars, server-enforced in `save`). The
`author` column keeps the key label for the audit trail only; display
is `poster_name || author`, so pre-signature rows still show their key
label ("master") until re-pinned or backfilled in Neon
(`UPDATE stickies SET poster_name='…' WHERE …`). The name is remembered
per browser (`recallName`/`rememberName`) and shared across all four
dialogs.

**Sounds**: `pop(kind)` in home.js synthesizes pick-up ('up'), put-down
('down'), and react/tie ('tick') pops through one lazily-created
AudioContext — never `new Audio()`/`<audio>` (the REC Room lock-screen
lesson). No files, autoplay-safe (every call rides a gesture), and it
fails silent in a try/catch.

## Corkboard transforms — the adjust pad (28 Aug 2026, third pass)

Rotate and scale have been through three designs in one day: drag
handles → select-then-keyboard → **the adjust pad**, which is what ships.
The keyboard scheme's click-to-select kept failing against real mice
(first on click jitter — fixed with a 6px slop — and then still for
Travis), so he called the pivot: no selection at all.

**The model now:** right-click an item → the menu offers **Scale**
(stickers only) and **Rotate** (everything) alongside React/Take it
down → picking one opens `#xf-pad`, a small fixed-position pad of real
buttons anchored above the item: `‹ ›` spin 5° per press, `− +` resize
5% per press, `✓` confirms. Adjustments preview live on the item;
**nothing is written until ✓** (and ✓ writes only if something changed —
one `saveXf` per confirmed session). Escape, opening another pad, a
board re-render, or starting a drag **reverts** the preview to the
values at open. No numeric readouts, deliberately. `xfPad`/`hideXfPad`
in `CAPCOM/js/views/home.js` own all of it.

Click-to-select is gone: plain clicks on items are inert, there is no
`.sel` state, no keyboard steering, and the dead handle CSS went with
it. Hold-to-drag (300ms) is unchanged, with one addition: if the hand
already flew past the 6px slop before the lift landed, `lift()` catches
the item up to the pointer — otherwise a fast grab-and-fling strands
the item where it was.

Verified with real CDP input on the stub rig (see below): both menus,
both pads, live preview with zero writes before ✓, exactly one write
after, Escape revert, quick flicks stay inert, hover hints updated. Not
machine-verifiable (CDP cannot hold a button — its drags complete in
~15ms): the >300ms hold-drag itself and the eager catch-up — the math is
shared with the verified paths, but they have not been driven by a real
held press. If dragging misbehaves for a human hand, start there.

**Local test rig** (how this was verified without touching prod): a
~90-line node server that serves `CAPCOM/` statically and answers
`/api/admin/:action` with canned JSON — all scopes on `whoami`, three
seeded stickies, a `/__transforms` introspection route recording every
`op:transform` body. Stub responses must honor the real API's contract:
`analytics` must be an object (the Stellar card reads `a.recent` inside
a `canStats` guard, so a 200-with-null throws where prod never would).
Serve everything `Cache-Control: no-store` and bump a query param to
force the pane to reload modules — same-URL navigates with a hash are
fragment jumps that reload nothing.

**Follow-ups, same night:** hover was snapping adjusted items back —
three layered `:hover{transform:… !important}` rules (the old static
board's straighten-on-hover) beat the inline transform that now carries
persisted rotation/scale. Hover rules must never touch `transform`
again; they keep shadow/z-index only. The dead `.xf-ctls`/old `.xf-btn`
block went with them (it collided with the pad's `.xf-btn`). And
clicking anywhere off the pad now **commits** exactly like the ✓
(document-level capture pointerdown) — Escape is the only revert.

Test-harness notes: the browser pane's `key` action does not map `plus`
— it arrives as `e.key === ""` (use `=`; read real key values from a
capture-phase logger before trusting a keyboard probe). Screenshot
coordinates ran at 1.6× CSS px this session — calibrate with a
pointermove logger instead of trusting the screenshot image, which can
render stale or offset. And in a hidden pane the compositor freezes CSS
transitions: `getComputedStyle` can read a transition's START value
indefinitely while the inline style holds the target and
`getAnimations()` shows the transition still alive — a computed
transform that disagrees with the inline style is a frozen transition,
not a stomping rule, when no `!important` rule exists. Probe twice
(hover out and back) before believing it.

## REC Room mobile light mode (2 Sep 2026)

Travis: "Deploy a light mode to REC room if easily adaptable. Don't
adjust the game content. Just the outside of the window." The mobile
room (`QlikRecRoom/mobile.html`) qualified — fully tokenized. The
**desktop room (`index.html`) is deferred**: its ink colors are raw
hexes (55 var uses vs 73 hardcoded), so it needs a tokenization pass
before a light theme is honest work rather than a regex sweep.
**2 Sep 2026: Travis paused light-mode dev entirely and had the
mobile light mode reverted** (commit e6c9b15, reverted in 4d09c4e) —
he judged it not complete. Do not rebuild it or start the desktop
pass unless he asks; the write-up above stays as the record of how.
The two symptoms he reported alongside the revert are pre-existing
dark-room issues, still open: the badge view leaves a large empty gap
above the tab bar on tall phones, and `#viewPlay.on` (fixed, inset 0,
z-index 40) covers the z-30 tab bar for the whole Play view — the
sheet's own comment says tabs should hide only while a game is
actually RUNNING, so the shelf hiding them contradicts the design.
**FIXED 8 Sep 2026** (Travis hit the trap live): tabs at z-index 45,
conn chip at 46 with explicit data-playing/data-down hides. The badge
view's tall-phone gap remains open.

## Mission Control calendar event modal (8–10 Sep 2026)

The learner-facing calendar (qlikmt-hero2.html) now shows EVERYTHING
the editor entered. `full_copy` — whose CAPCOM hint literally said
"not shown anywhere yet" — renders as the body (pre-wrap paragraphs)
with the short `detail` as a bold lead above a rule. Links, both
ways: URLs typed inside the copy become inline anchors (escape THEN
linkify — hand-typed copy stays injection-safe), and a labeled LINKS
row gathers the event's `link` (Open) plus every URL found in the
text as hostname chips. Layout per Travis: wider, not scrollier —
base 640px; a FIT LADDER in openCalModal runs synchronous measures
(no rAF) after populating: too tall → `wide` (840px), still →
`compact` (smaller type), still → `overflow` scroll capped to the
CONTAINER (100%, never 100vh — the page's mobile scale transform
makes vh lie, and fixed-position is relative to the transformed
ancestor). Modal anchors `position:fixed` for max headroom. Short
events never engage the ladder. All three doors (pills, month list,
billboard) go through openCalModal, so one fix covers all.

## Staff org CHART (8 Sep 2026)

Travis's vision replaced the indented list: person CARDS with
connector wires — the root (Nick) on top, a stem to a rail across the
leadership tier (.org-cell ::before stem + ::after rail, halved on
first/last, hidden on only-child), and each leader's reports in a
vertical column beneath (.org-vcell stems, recursive). Cards carry
avatar, trigram chip, title, OOO, the status post + reactions, Invite
and ⋯ for leaders; tap/Enter opens the profile. The chart lives in
.org-chart-scroll (overflow-x) so the page never scrolls sideways.
TEAM NAMES ARE GONE from Staff — Travis: "we don't really have
separate team names, we are just Global Sales Enablement; people
leaders just handle different projects." Teams manager stays on the
Board toolbar only. Org color from Travis: he is "a hand to the king"
(creative lens, new tech, assists Barb on certifications); Barb owns
quarterly certifications, no reports anymore — neither carries the
people-leader flag, both sit directly under Nick.

## The manager tier (2 Sep 2026, schema v3)

Travis named seven managers who "control all aspects (except anything
that can delete the site entirely — that's only allowed for the super
admin)" and are "the only ones able to assign new keys to users and
responsible for signing up their team": Nicholas Gregory LND, Mike
Fawcett DKQ, Steve Smart SYK, Eric Payne RJF, Rafael Attux KYI, Barb
Vogt QRC, Travis TVO (emails First.Last@Qlik.com).

Mechanics: `team_members.is_manager`. A manager's `TRI:code` sign-in
gets `scopes = SCOPES` from auth.js but `master:false`, so master-only
operations (admin_keys, secrets — the site-fatal class) stay with
ADMIN_KEY/ULTRA. Registry ops (members save/retire/resetCode) are
manager-or-master only; tag/untag stays plain projects scope. The
roster seeds ONCE behind a `managers_seeded` app_state marker (the
staff_seeded pattern) so demotions survive Setup re-runs; it promotes
existing trigram rows in place and fills only blank title/email.
Compat rule that mattered: auth.js and the projects list both select
`is_manager` inside a fallback (retry without the column) so member
sign-in and the Board keep working on a pre-v3 database — deploy goes
out before anyone runs Setup. Client: registry UI keys off
`who.master || who.manager` (whoami now returns `manager`), rides into
shared dialogs as `d.canManage`; the member edit dialog has a Manager
checkbox. Note: is_leader (people-leader, org chart) and is_manager
(access tier) are deliberately separate flags.

Later same day: the Staff tab became the ORG TREE, top level down —
manager_id is the structure, teams are a row detail. Setup seeds the
leadership org once (`org_seeded`): Nick (LND) tops the tree, the
other six leadership members report to him (only where no line
exists), and LND/DKQ/KYI/SYK are people leaders — per Travis, Mike,
Rafael and Steve have people under them; he does not.

## Invite-only access + walkthrough + Help (2 Sep 2026, schema v4)

Travis: "I don't want ANYONE to be able to become a member. Invite
only." Claiming now requires a ONE-TIME invite code a manager issues
(members `op:'invite'`, manager/master only) and sends themselves —
plaintext returned exactly once, stored scrypt-hashed, 7-day expiry,
burned on use. memberClaim takes {trigram, invite, code} and enforces
the password policy server-side: 10+ chars, ≥1 number, ≥1 symbol. A
fresh invite doubles as password reset; the old password works until
the new one lands. The gate's claim dialog grew a live 4-bar strength
meter (pwScore in app.js — 0 fails policy, then weak/okay/good/strong).

First-run walkthrough: `CAPCOM/js/tour.js`. Spotlight ring + card
glitch in over each `[data-tour]` hook (9 stops on Home + sidebar +
theme + Help), synth blip per step, Back/Next/"Skip all tutorials"
(localStorage `capcom.tour` = done/off). Auto-starts once right after
an invite is redeemed (sessionStorage `capcom.tour.pending` handoff
from the gate); replays from Help. Hard-won placement rules: content
is set BEFORE measuring the card; placement tries below → above →
beside with viewport clamping (a tall target like the sidebar fits
neither above nor below); targets that exist but are not really on
screen (the drawer nav under 880px) are SKIPPED via a visibility
check, or the ring spotlights nothing. The glitch settles in .38s and
never animates text someone is reading; reduced-motion drops to a
fade. In the hidden browser pane CSS ANIMATIONS freeze mid-keyframe
just like transitions — a card stuck half-clipped in a screenshot is
the harness, not the code (set animation:none to verify layout).

## SE team staff-tagged + MT Roster (3 Sep 2026, schema v9)

One-time seed (se_staff_seeded): the seven leaders + nine team
members (OTQ IHK BPX QZO UCY under DKQ; SKJ RZQ under KYI; QPE RVL
under SYK) get zeroed players rows with staff=true — created even for
people with no MT access, so exclusion holds from their first-ever
run (every board, in-game game-over included, reads getExcluded) —
plus team_members rows under their leaders (Laurel OTQ keeps her
talend.com email; Jochem is ZwiEnenberg per the MT export, not
Travis's spelling). Untagging via MT Roster is never undone by Setup.
"Players" is now "MT Roster" (route unchanged) and lists every
player — the top-50 LIMIT is gone. Phase-2 note from Travis: the
non-MT folks will get room access later ("keep scores valid while
opening access").

## Staff status posts (3 Sep 2026, schema v8)

`team_members.status_text/status_at` + `staff_status_reactions`. A
member posts their own informal status from their profile (server
checks member id; managers can clear anyone's); it renders in italics
under their org-tree row with grouped emoji reaction chips (`+` opens
a pctx picker; chip tooltip lists reactors). LIFECYCLE RULE from
Travis: editing or clearing the text deletes the post AND all its
reactions forever — the status op wipes staff_status_reactions in the
same call, statusReact 409s if the post is gone. Self-service ops a
plain member session may run: ooo, status (own row), statusReact
(anyone's post). The members select fallback became a walk-back list
(v8→v6→v3→v2) — add a tier per schema bump, never nest deeper.
Also: hover cards got a fallback (unknown trigram still answers),
roster names reach CAPCOM's player pops + a Players Name column, and
scoreboard rows force cursor:default (no I-beam over names).

## REC roster + scoreboard who-pop (3 Sep 2026, schema v7)

`rec_roster` (trigram PK → name, title, country, iso2, active),
imported through Maintenance's REC Roster card from the Mindtickle
user export converted to JSON (chunked upserts, managers only). RULE:
the roster is employee data and this repo is PUBLIC — it never gets
committed; the conversion (xlsx → rec-roster.json with a country→iso2
map) runs locally and the file goes to Travis, not to git.
getLeaderboard/getRecentScores decorate rows per-trigram-shown
(sub-wrapped) so the full roster is never served. Desktop scoreboard:
`#whoPop` hover card (delegated mouseover on `[data-tri]`, flips at
the viewport edge, hidden on touch, hidden on segment rotation).
Roster notes from the 3 Sep export: 856 unique trigram holders, six
duplicate trigrams in the sheet (CAF ENW LEW SVW UVX PQL — last row
wins), 5 marked "Did not Sign up" (kept, active=false), all seven
leadership trigrams verified with matching names.

## Leadership Brief + staff profiles (2 Sep 2026, schema v6)

**The Brief** (`lib/admin/brief.js`, `views/brief.js`, Projects group,
projects scope): week/month/quarter compiled deterministically from
projects/project_log/milestones — movement, milestones hit/ahead,
overdue with the written notes, new projects, LULLS (active projects
and teams with zero window activity) — Copy As Text for the update
Nick/Mike send upward, plus a manager-only Home teaser. Narrative
layer: ANTHROPIC_API_KEY slot in Keys & Services; when set, a button
sends the COMPILED digest (never raw DB) to claude-opus-5 via the
official @anthropic-ai/sdk (new npm dep) for 2–3 exec paragraphs,
cached 6h per window in api_cache (`brief_<window>`). Design rule:
facts never depend on the AI layer — no third-party single point of
failure in leadership reporting.

**Profiles**: team_members + avatar_url (uploaded via the banner-art
Blob pipeline, shown on Staff rows + profile head) and ooo_note
(members set their OWN via members op:'ooo' — the one op a member
session may run, self-only; managers set anyone's). The profile
dialog shows REC Room performance joined from players by trigram
(recs in the projects list bundle, sub-wrapped). Members select now
has THREE fallback tiers (v6 → v3 → v2 columns).

Later: tours went PER-PAGE. `TOURS` maps route → steps; steps resolve
by [data-tour] hook, by CARD TITLE match on `.sec-title h2` (titles
are stable; nth-child is not), or by selector. Each page tours the
first time it is opened (localStorage JSON `{off, done:{route}}`,
legacy strings migrate); `killTour()` in draw() tears an overlay down
on route change WITHOUT marking done. Harness trap: a hidden pane
with no viewport emulation reports `innerWidth 0`, which fails every
visibility check — emulate a size before concluding the tour broke.

Help & FAQ: `views/help.js`, nav item for every key holder — twelve
area blurbs, six FAQs, replay button, and bug reports (`lib/admin/
bugs.js` + bug_reports table): anyone files, it lands in the change
feed, managers resolve.

Also same day: **Access & Setup split in two.** `views/system.js` is
gone — key generation + the key list moved to **Tailored Access**
(`views/tailoredAccess.js`, Projects group below Staff, system scope),
which is for SMEs and outside contributors ONLY; Keys & Services and
the Setup button moved into **Maintenance** (the machine room). The
System nav group is now just Maintenance + Help & FAQ. The Staff tab
leads with Travis's exclusivity rule (staff only, no SMEs) and a bar
at the bottom points targeted-access cases at Tailored Access. Nav
routing note: nested routes like `#projects/access/param` head-match
to the Board, so new Projects-group pages get exact two-segment
routes and no deep-link params.

Follow-ups the same day: the invite ISSUING UI was missing (server op
shipped without a button — lesson: a feature is not done until both
ends exist) — now an Invite button on every Staff row, a how-it-works
line under the header, "no access yet" on unclaimed rows, and
`inviteDialog` showing the code once with Copy. Schema v5: invites
store `invited_by`; the feed reads "NAME redeemed their invite code
sent by SENDER" (pre-v5 fallback in memberClaim). And member sessions
sign the Community Board automatically — stickies save/react take the
name from `who.member` server-side whatever the client sends, and the
four board dialogs hide the Your-name field for members (key sessions
still type one; a key label is not a person).

**Same morning, a wrong turn worth remembering:** Travis's screenshots
showed two dark REC Room widgets on the white mobile Mission Control
page (a REC ROOM logo tile and an "Install the Mobile REC Room" card)
and asked for them white on mobile. I whitened the `.mcard` compact
state in `QlikRecRoom/index.html` — pixel-identical to the tile — but
Travis stopped it (commit 6bac450, reverted in 25f4d4f): his phone
never changed, because **neither widget is served from this repo at
all**. Both are hard-coded HTML inside Mindtickle's Custom HTML
widget, with its own logic that swaps in that markup for the mobile
app instead of the iframe. That is why no caption text matched
anything in the repo or its history. Lesson: when a Mindtickle widget
resists a deploy, suspect MT-side pasted markup before repo code —
and a pixel-match is not provenance. **Pending: Travis will paste the
MT widget code from his desk; the job then is white-mode versions of
those snippets (MT strips nothing he already uses — mirror whatever
mechanism the paste shows), leaving the room and every repo-served
card dark.**

How it works: `html[data-theme="light"]` overrides the `:root` tokens
plus the body gradient, `.tabs`, `.conn`, field backgrounds, and the
Play view's fixed backdrop (shelf chrome — the game is `#gameFrame`,
its own document, untouched along with everything under `games/`).
A pre-paint script in `<head>` reads `recroom.theme` before the
stylesheet lands so a stored light room never flashes dark. The toggle
is a ghost button on the badge view beside Switch Trigram. Default is
dark — the arcade's identity. The framed Mission Control card pins
itself white via `data-frame` rules that come later in the sheet and
tie at specificity, so theme state can't leak into the widget.

Two traps worth keeping: the VT323 display type was `color:#fff` in
ten separate rules (dark-room assumption) — light mode re-inks them as
a selector list, `.down`/framed excluded. And scoping CSS variables on
an overlay (`.down{--ink:…}`) does NOT protect descendants that never
say `var(--ink)` themselves — they inherit body's **resolved** color,
so the overlay must set `color:var(--ink)` on itself. Rig note: the
room locks phones to the install screen unless standalone, so the
verify rig injects `Object.defineProperty(navigator,'standalone',
{value:true})` at serve time and proxies `/api/*` to prod for live
data — source untouched.

## Multi-day events + click-to-create (14 Sep 2026, schema v10)

Huw's sticky on the Community Board (11 Sep) asked for two calendar
things; Travis scoped out any special category — "protected seller
time" was a for-instance, not a taxonomy request. Both shipped in one
commit.

**Click-to-create (CAPCOM only):** every day cell in the Calendar
view's Live Preview now creates. Empty days take the click directly
(`.mc-free`); occupied days wear a small `+` (`.mc-add`, hover-shown,
faintly always-on under `pointer:coarse` per the ⋯-chip precedent; its
click stops propagation so it cannot fight the spotlight cycle). Both
open the editor with the date prefilled — the whole point: the date
can no longer be mistyped. `#calendar/new/<iso>` deep-links the same
way. The occupied-day click still cycles that day's events; the cycle
key is now the CLICKED iso (`litKey`), not the event's start date, so
cycling works from any day a span covers.

**Multi-day:** `events.end_date` (date, null = single day) — ALTER in
migrate, SCHEMA_VERSION 10. `saveEvent` validates it like the start
(real date, end strictly after start, span ≤ 31 days as a typo guard)
and falls back to the legacy statement on a pre-Setup database; a save
WITH an end date on one gets "run Setup under Maintenance first"
instead of a 500. Both reads (`listEvents`, `/api/command/events`) try
the rich select and retry without the column — the public feed
degrading to `{events:[]}` would silently pin both hero pages on their
stale hardcoded fallbacks, which is exactly the failure mode the
fallback-select rule exists for. The feed emits `end` /` end_month` /
`end_day` ONLY when set, so single-day events are byte-identical to
before and every hardcoded fallback stays valid unchanged.

**Rendering rules, applied everywhere:**
- An event belongs to EVERY day its span covers. The expansion helper
  is deliberately duplicated per file (no build step): `spanDays` in
  CAPCOM calendar.js, `feedSpanDays` in home.js (the public feed calls
  the column `end`), `evSpanDays` in qlikmt-hero2.html. All cap at 62
  iterations defensively.
- "Past" means the END has passed: `isPast(iso, endIso)` in CAPCOM
  util.js and `isPastEvent(iso, endIso)` in both hero pages grew an
  optional second argument — an in-progress Connect must not dim on
  its own day two. Chip-slot filling (`buildList`/`lcBuildDates` in
  qlikmt-hero.html) keys ahead/behind on the same end date, so a
  running event holds its slot.
- Month lists intersect the SPAN (lexical compare, `'-31'` as a safe
  month cap in `calMonthEvents`), so Sep 29–Oct 2 appears in September
  AND October — labeled from the event's own dates, not the viewed
  month. (`calLiHTML` used to print `CAL_MONTHS[calM]`, which was
  already wrong for a spillover pill; deriving from the event fixed
  both.)
- Labels: `fmt.span` (CAPCOM), `evDayLabel`/`evDateLine` (hero2, short
  and modal-with-year forms), `ueDateLabel` (hero, from the feed's
  denormalised month/day strings): 'Sep 14–18' same month,
  'Sep 29 – Oct 2' across months, years added in the modal line.
- The Spotlight/preview glow lights the WHOLE span (`light` in
  CAPCOM's preview takes an iso array now; `fillBB` in hero2 clears
  `.cal-cell--spot` with querySelectorAll and lights each covered
  cell).

**Same day, follow-up:** Home's calendar widget composes with the deep
link — with the calendar scope, EVERY day cell there is clickable now:
occupied days go to `#calendar`, empty days go to
`#calendar/new/<iso>` (Calendar view, editor open, date prefilled).
Without the scope nothing changed (cells stay inert). Verify note: a
`navigate` back to `#home` on the rig is a fragment jump that reloads
nothing — dialog state from the previous probe survives it; bump a
query param to genuinely reload.

**Verified on a fresh stub rig** (`capcom-stub/stub.js` in the session
scratchpad — serves the repo statically with canned admin+command
APIs, records saveEvent bodies at `/__saves`; five seed events cover
single-day, in-progress, past-multi-day, same-month and cross-month
spans). Click-through: empty-day create arrived at the API with the
clicked date and typed end date; edit round-tripped both dates; hero2
grid/list/modal/spotlight and hero chips all rendered every case.
`node --check` on all 8 touched JS + both extracted inline scripts,
mojibake 0, dash counts up-only. **Rig gotcha for next time:**
`preview_start` reads `launch.json` from the SESSION root's `.claude`
(`D:\.claude\`), not the repo's — a repo-level `.claude/launch.json`
is ignored and the tool may launch whatever config the session root
holds (it started Travis's crawler-io once before this was
understood).

## Q3 cert hero: Training Center button removed (14 Sep 2026)

Travis, reviewing the Built-to-Win experience: the cert page's hero CTA
"Open the Qlik Training Center" is gone —
`Certifications/2026/FY26_Q3/index.html`, the only `[data-cfg]` user, so
`CONFIG.links.certApp` (the replit URL) went with it; the links object
stays, empty, for future buttons. The cohort-windows copy now leads the
CTA row and the layout holds (verified on the rig at `?s=hero`). The
seven other "Training Center" mentions are instructional body copy
(module steps, sync note, FAQ) and were deliberately left. WHY it went (from Travis): a hero-level button reads as "click here first," and the Training Center is NOT the first step — people were starting there instead of where the flow actually begins, so the entry point came off the header. Do not re-add a hero CTA to it. Also note the
button's target — training-center-gse.replit.app — is only unreferenced,
not decommissioned — and it is NOT OURS to decommission (an external site Qlik doesn't own); it remains reachable through the flow the instructional copy describes.

## Vercel Blob quota fire (2 Sep 2026)

Vercel emailed at 75% of the free tier's 2,000/month Blob **Advanced
operations**. Cause: the dashboard status board polls
`/api/admin/systemStatus` every 60s, and the blob probe ran
`list({limit:1})` — an Advanced op — on essentially every poll,
because the 60s in-memory cache dies with each cold lambda. About a
day of an open dashboard tab ate 1,500 ops. The file's own doctrine
("a status board that burns the day's quota checking quota is
self-defeating") was already applied to the news probe but not here.

Fix: the real `list()` runs at most every 6h (30m after a failure),
throttled through an `api_cache` row (`key='blob_probe'`) so all
lambdas share one clock; between pings the board serves the cached
verdict with "verified Xh ago". Side fix: the news probe's freshness
query read `api_cache` with no key filter (`ORDER BY fetched_at DESC
LIMIT 1`), so any new cache row would pose as fresh news — now
`WHERE key='news'`. **Rule: anything that counts against a paid quota
must be throttled through the DB, never through lambda memory.**

## Systems Watch: Qlik Cloud added (16 Sep 2026)

Rafael asked for Qlik Cloud's Operational Health in the Stellar-Seller
banner's Systems Watch lineup (`SalesCommand/stellar.html`, fed by
`/api/status` → `lib/command/status.js`), alongside Claude, ChatGPT,
Gemini and Mindtickle. Both `SERVICES` (stellar.html) and the
`Promise.allSettled` + `names` pair (status.js, positional — see the
existing NOTE above it) grew a fifth entry.

**The public page is not the API.** `https://status.qlikcloud.com/`
is a custom Qlik-branded wrapper — its own `/api/v2/status.json` 404s.
It embeds the real Atlassian Statuspage instance in an iframe at
`https://statusp-pb8g4h.qlikcloud.com/`, and *that* domain has the
standard `{status:{indicator,description}}` shape the other three
services use. (Superseded below, same day: it now also pulls
`components.json` from the same instance, so it has its own fetcher,
`fetchQlikCloud`, rather than reusing `fetchAtlassian`.) **If Qlik ever
rotates that generated subdomain, find the new one via the iframe
`src` on the public page before assuming the endpoint moved or
broke.**

Five services broke the desktop-mobile `.svc` grid's assumption of an
even count: the compact/mobile view (`html[data-compact="1"] .svc` and
the `max-width:700px` twin) is a fixed 2-column grid, so a 5th item
landed alone in the left column. Fixed with `.svc-item:last-child:
nth-child(odd){grid-column:1/-1;justify-self:center;width:fit-content}`
in both places — a lone trailing item on an odd count now spans and
centers itself instead. The desktop row (`flex-wrap`) already handled
any count without changes. Verified with a local static server and an
injected mock response (all five states, including a live "major"
DORC ATTACK for Qlik Cloud — the current real status, coincidentally)
at both full width and `data-compact="1"`.

## Systems Watch: Qlik Cloud regional callout (16 Sep 2026)

Same day, same feature, extended: Travis saw a live UAE-only outage
and asked for per-region granularity on Qlik Cloud specifically, with
a small callout showing which areas are affected — the flat "major"
indicator alone can't say that only one of thirteen regions is down.

**`fetchQlikCloud` replaced Qlik Cloud's `fetchAtlassian` call** in
`lib/command/status.js`. It still fetches `status.json` for the
aggregate (unchanged shape/behavior for everyone downstream), then
best-effort fetches the same Statuspage instance's `components.json`
and filters to components named `Qlik Cloud <dash> AWS <dash> ...`
that are not `operational` — the `<dash>` in that pattern really is
two different characters in the wild (`–` vs `-`) depending on which
region was added when; the regex handles both explicitly rather than
trusting one. **Deliberately excluded:** the Government/FedRAMP/DOD
components and the Talend Cloud components that live on the same
Statuspage page — not this widget's audience. If the components fetch
fails, the whole entry still returns fine with no `regions` key; that
failure is swallowed on purpose, per the file's existing "a bonus
data point failing is not fatal to the aggregate" pattern.

**Client side:** `stellar.html` gained `paintRegions()`, called
alongside `paintServices()` from the same `loadStatus()` fetch. It
flattens any `regions` arrays found across the whole response (today
only Qlik Cloud can have one) into a single callout box (`#svcRegions`,
`.svr`), hidden via the `hidden` attribute when there is nothing to
show. `classify()` grew the raw Statuspage component vocabulary
(`degraded_performance`, `partial_outage`, `major_outage`,
`under_maintenance`) alongside the indicator vocabulary it already
handled, since regions carry the former and the top-level aggregate
carries the latter — same function, same DORC-themed labels, both
inputs. The box's border/kicker color is the WORST region's severity,
not the first one, so one major regional outage next to a merely
degraded one still reads red.

**Hit the `[hidden]`-loses-to-`display` trap again** (see Gotchas,
the `.mcard [hidden]` precedent) — `.svr{display:flex}` as an author
rule beat the browser's default `[hidden]{display:none}`, so the
empty-state callout rendered as a visible empty bordered box instead
of vanishing. Fixed the same way: `.svr[hidden]{display:none
!important}`. Caught by testing the *empty* case explicitly, not just
the outage case — the outage screenshot alone would have looked
correct and shipped the bug.

Verified locally (temporary `api/status` mock file, deleted after,
never committed) across: no regions (box absent, zero layout cost),
single region, two regions at different severities, `data-compact="1"`,
and `data-theme="light"`.

**Second pass, same day: the box can clip inside Mindtickle's real
iframe.** Travis had the actual admin builder open and pasted the
banner widget's own CSS:

```css
.qlik-ss-banner{ width:100%; height:300px; border:0; display:block; }
@media (max-width:900px){ .qlik-ss-banner{ height:auto; min-height:200px; } }
```

Two things followed from that ground truth. **First**, the compact/
mobile path (`compact=1`) was already confirmed clipping against a
real fixed-height iframe rig — the wordmark + Systems Watch row alone
already use nearly the full ~200px budget, so any extra content there
is invisible, not wrapped or scrolled. The box is now hidden outright
in compact mode: `html[data-compact="1"] #svcRegions{display:none
!important}`. Mobile keeps the Qlik Cloud chip's own accurate
aggregate state, just without the regional breakdown.

**Second, easier to miss:** this page's own compact-layout breakpoint
(`@media(max-width:700px)`) and Mindtickle's real height breakpoint
(900px) don't line up. Between 700 and 900px viewport width, this page
still renders its full "desktop" layout (thinks it has room) while the
OUTER iframe has already dropped toward its 200px floor — confirmed on
the rig: full content reached ~340px at 850px width against a real
~200px budget, silently clipped by the iframe boundary with no
scrollbar to reveal it. The box's hide rule therefore lives in its own
dedicated `@media(max-width:900px)`, deliberately NOT folded into the
existing 700px compact-layout block — the two breakpoints protect
different things and widening the existing one would have also
changed the chip grid layout at widths where that isn't broken.
Regional breakdown is now strictly >900px-only. Full desktop (900px
and 1400px tested) has real headroom: complete stack including the box
lands around 230px at 900px, nowhere near the 300px ceiling.

**Pre-existing, not caused by this feature, flagged not fixed:** even
with the regions box now gone, the base 5-chip row sits right at the
~200px edge in that same 700-900px band — worth a look if anyone
revisits this widget's breakpoints, but out of scope for this change.

**Third pass, same day: wrong UI entirely.** Travis: he never wanted
a permanent bar under the row — he wanted a hover popover on the Qlik
Cloud chip itself. Everything above (the `#svcRegions` element, `.svr`
CSS, `paintRegions()`, both breakpoint-hiding rules) was removed. The
replacement is a `.svc-tip` nested INSIDE the chip's own markup
(`regionTip()` in `paintServices()`, only when `rec.regions.length`),
shown via plain `.svc-item:hover .svc-tip{opacity:1}` — no JS toggling
at all.

This redesign also retroactively obsoletes the entire second pass
above: a `position:absolute` element with nothing reserving space for
it costs zero layout when hidden, and it opens UPWARD (`bottom:100%`)
over already-visible content rather than downward past the iframe's
fixed height. There is no width where it can clip, so the 700-900px
gap and the compact-mode exclusion aren't needed — kept the prior
write-up anyway, because "we measured the real iframe CSS and found a
breakpoint mismatch" is exactly the kind of thing worth being able to
find again if a future permanent-element idea resurfaces here. The
native `title` attribute is suppressed on any chip that has a
`.svc-tip`, so hovering Qlik Cloud during an incident doesn't fire two
overlapping tooltips (the browser's plus this one).

Verified: hovering Qlik Cloud during the live UAE incident shows
"Regional impact — Middle East (UAE) · DORC Attack"; every other chip
is inert on hover (no empty popover); compact mode unaffected (chips
render, nothing pops — hover doesn't fire on touch anyway, so this
was never really a mobile concern).

## Retired questions expire after 48h (21 Sep 2026, schema v11)

Retiring used to be an archive: `deleteQuestion` set `active = false` and the
row sat in the bank forever, out of the game but still in the Control Room
list. After the Brain Freeze bank was replaced that left 36 dead Q3 rows in
the view, which is what prompted this.

Retire is now a **soft delete with a grace period**. `retired_at timestamptz`
on all three banks; `deleteQuestion` stamps it, `saveQuestion` clears it on
restore and `COALESCE`s it on an edit so fixing a typo on an already-retired
row does not buy it another 48 hours. `listQuestions` DELETEs anything past
the window before it lists.

**The purge is lazy, on purpose.** There is no cron. `listQuestions` is the
only thing that deletes, so rows can outlive the window until someone opens
the Questions view — which costs nothing, because a retired row is already
out of the game. This keeps the "no third infra provider" line and adds no
scheduled invocation.

**The window lives in ONE place**, `lib/admin/retireWindow.js`, and reaches
the client as `retire_hours` in the listQuestions payload. The countdown ring
reads it from there rather than keeping a second copy — the same drift that
let the Blitz preloader fall out of step with its clip counts.

The ring is a `conic-gradient` pie on the row's **Edit** button (Edit is the
way back: Restore lives inside it), repainted each minute by a `setInterval`
that dies with the view. `.q-row.retired` is already `opacity:.45` and a child
cannot exceed its parent's opacity, so the arc uses full-strength `--danger`
over a light track to stay legible through the fade.

**This is destructive and it is not reversible.** Past the window the row and
its `attempted`/`correct` counters are gone, so the question drops out of the
most-missed readout. Nothing outside a bank references a question id, so
nothing is left dangling. Rows retired before v11 have no stamp; migrate
backfills them to `now()` rather than treating null as expired, so nothing
vanished the moment this shipped.

Pre-Setup databases have no `retired_at`. Every touch of it is wrapped and
falls back to the pre-v11 statement, same shape as `saveEvent`'s `end_date`
guard — the ring simply does not render until Setup has run.

## Per-member scopes (22 Sep 2026, schema v12)

Juan (UCY) tried to add a calendar event and was refused. Not a widget bug —
`auth.js` read `scopes: manager ? SCOPES.slice() : []`, so a member session was
**all-or-nothing**: every scope if `is_manager`, none otherwise. There was no
way to say "Juan edits questions" short of making him a manager, which would
also hand him `system` — the maintenance switch and key minting, the site-fatal
class this codebase deliberately reserves for master/ULTRA.

`team_members.scopes text[]` closes the gap. A manager still gets everything;
everyone else gets exactly what was ticked on their Staff row (⋯ → **Access…**,
manager/master only, `members op:'setScopes'`).

**`GRANTABLE` is narrower than `SCOPES` on purpose** — calendar, banners,
content, analytics. `system` is out for the reason above. `projects` is out
because reads there are already open to every key holder and a tagged member
can already move their own projects, so granting it would only add
create/retire/tagging, which is a manager call. The list is enforced three
times: `setScopes` rejects anything outside it, `identify()` re-filters on
every read, and the client's `AREAS` mirrors it — so a hand-edited row still
cannot smuggle `system` through.

**The walk-back select needed a real third tier, not a new top one.** auth.js
had two: rich, then pre-v3. Adding `scopes` to the rich select alone would mean
a deployed-but-not-yet-Setup database throws on the missing column and drops to
the pre-v3 tier — which also drops `is_manager`, **silently demoting every
manager** until someone ran Setup. The middle tier (v3..v11: managers yes,
scopes no) exists entirely to prevent that. Same reason `MEMBER_SELECTS` in
projects.js gained a v12 entry above v8 rather than editing v8.

Setting scopes on a manager 409s rather than silently doing nothing — they
already hold everything, and a checkbox that appears to work but changes
nothing is worse than a refusal.

`whoami` already returned `who.scopes`, so the nav filters itself with no
client change; the Access dialog is the only new UI.

## Read-only Tailored Access: the 'access' scope (29 Sep 2026, NO schema change)

Travis listed what staff should see ahead of showing the platform to the wider
team. Four of the eight items — Project Board, Insights & Calendar, Staff,
Help & FAQ — are `scope: null` and were **already visible to every member**;
reads there were left open on purpose because visibility is the product.
Dashboard and MT Roster are both `analytics` and cannot be separated. Questions
is `content`. All grantable already.

The odd one out was **Tailored Access, which is `system`** — and it is not a
viewing page, it MINTS keys. A minted key can carry any scope including
`system`, which also opens Maintenance and the switch that closes the REC Room.
Granting it so staff could see who holds which key would have traded the site
for a list.

New scope **`access`**: SEE the key console, cannot mint or revoke. `keys.js`
now admits `['system','access']` at the door and re-checks `system` inside
`create`, `revoke` and `restore`; the view hides `+ New key` (a `read-only`
chip in its place) and replaces Revoke/Restore with plain `active`/`revoked`
text. The client hiding is a courtesy — **the server is the gate**, and the
deep link `#projects/access/new` cannot open the mint dialog without `system`.

**No DDL, no SCHEMA_VERSION bump, no Setup.** `team_members.scopes` is already
`text[]`, so a new scope is only a new string in `SCOPES`/`GRANTABLE`. That is
worth remembering: adding a scope is a deploy, not a migration.

`allowed()` in app.js now takes a string OR an array for `it.scope` (ANY
admits), matching the rule `requireScope` already used server-side.

**Rig note.** The stub served `/api/admin?action=x` only, but the real client
calls `/api/admin/:action` — production rewrites the path form to the query
form in `vercel.json`. The stub's fallback returned an object with no `scopes`,
and the gate died on `WHO.scopes.includes` — which looks exactly like a bug in
the new nav code and is not. A stub must honour the ROUTING contract, not just
the response shape. (`vundefined` on the sidebar chip is the same class of
thing: `code_version` comes from whoami and the stub omitted it.)

**Same day, follow-up: the Dashboard is open to everyone.** Travis wanted the
whole team to see scores and REC Room data. `analytics.js` now takes
`requireScope(req, res, null)` - any valid key, member sessions included - and
the Dashboard nav entry is `scope: null`.

The justification is that the numbers were never secret:
`/api/recroom/getRecentScores` is KEYLESS and public and already returns
trigram, name, title, country and score to anyone with the link. Gating the
same figures behind a scope protected nothing while keeping the team from
seeing how their own game was going.

**MT Roster keeps `analytics`**, because it is the page that can flag someone
as staff. That write (`setStaff`) demands `system` and is untouched. Be honest
about what the nav gate is doing though: both views call the SAME
`api.analytics()`, so the payload MT Roster renders is reachable by any member
who calls the endpoint directly. The gate is presentational. It is acceptable
only because the payload carries nothing the keyless public endpoint does not
already hand out - if analytics ever starts returning something genuinely
private, that gate has to move into the endpoint, not the nav.

## "See what they see" — preview mode (29 Sep 2026, client only)

Travis asked to test the new staff permissions from the other side before the
demo. Logging out, minting a throwaway key or borrowing someone's password all
work and all cost more than the thing being checked, which is simply: *does
their sidebar look right?*

`CAPCOM/js/preview.js` holds a session-only identity. `app.js` gained one
indirection - `const VIEW = () => effectiveWho(WHO)` - and `allowed()`, the
Setup banner and the version chip now read `VIEW()` instead of `WHO`. That is
the entire feature. It works because the sidebar was already driven by exactly
one thing: `WHO.scopes`. Nothing else in the shell knew about permissions, so
nothing else had to change.

`effectiveWho` also clears `master/manager/people_leader/leader`. Scopes alone
would leave Leadership Brief and the Setup banner showing, because those are
gated on `it.gate(w)` reading the leader flags, not on a scope.

**The banner is loud on purpose and says what the preview does NOT prove.**
Every API call still carries the real key, so a page opened during a preview
loads data that person could not actually fetch. It answers "what is in their
sidebar", never "what can they do". The real boundary is `requireScope` on the
server and the only honest test of it is signing in as them.

**Session-only, no localStorage, deliberately.** A preview that survives a
refresh becomes a permissions bug that nobody can reproduce.

`preview.onChange` re-runs `previewBar() + buildNav() + draw()`, so the switch
is instant and Exit puts everything back without a reload. The row menu entry
is gated on `canEdit` - previewing rearranges YOUR sidebar, which would alarm a
staff member who saw it happen on their own screen.

Verified on the stub: Juan (no scopes) collapses to Home / Project Board /
Insights & Calendar / Staff / Dashboard / Help & FAQ; Huw
(`access, analytics, content`) additionally gets Tailored Access, MT Roster and
Questions. Neither sees Calendar, Focused Headlines, Action Banner, Leadership
Brief or Maintenance.

## REC Room split: scoreboard vs health (29 Sep 2026, client + one scope)

Travis: "MT Roster should be something different than scores... more of a
maintenance-related category to check on status, activity. The REC Room
Dashboard should be more of a live score board where the Enablement team can
go in and see ALL the scoring data easily and see who the leaders are and
what their name is."

The two pages had drifted into each other. The Dashboard was half systems
board and half analytics report; MT Roster was the scores table under a name
that says roster. They swapped the halves that were in the wrong room.

**Dashboard** (`scope: null`, everyone) is now the scoreboard: the territory
map, a named leaderboard, per-territory podiums, the live run feed, the full
sortable table, then the charts. **MT Roster** (`analytics`) is the health
page: the systems board, roster coverage, activity bands, and the import.

**Names were already on the wire.** `analytics.js` has joined `rec_roster`
onto every `top` and `recent` row since the roster import; the board just
printed the trigram and hid the person in a hover card. Ranking "SKJ" is
fine for the arcade screen and useless in a meeting. Nothing server-side had
to change for the single thing Travis actually asked for.

### The map ports because it was never a map

`CAPCOM/js/recmap.js`. Four PNG silhouettes used as CSS `mask-image`, each
filled with its territory color — no projection, no geo data, no library.
The asset path is ABSOLUTE (`/QlikRecRoom/assets/...`) because CAPCOM answers
on both `/CAPCOM/` and `/ControlRoom/`, and a relative path would resolve
differently depending on which door you came in.

Two deliberate differences from the room's copy:

- **All four territories stay lit.** The room lights only the scored top 3,
  which is good drama and bad information: "LATAM is dark" should mean
  "LATAM has no points", not "LATAM is fourth". Standing is carried by the
  leader's halo and a rank badge on the pin instead.
- **The panel keeps its navy ground in BOTH themes.** These are neon colors
  picked against #10172A; on the light theme's white card they read as
  highlighter. It also keeps this map and the wall map the same object.

`point()` maps each centroid through the same contain/center fit the masks
use, so a pin lands on the right landmass at any panel size — and `paint()`
is called LAST, after the panel is in the document, because a detached panel
has no width and every pin piles into the corner. That is the same trap the
room's fx canvas fell into at its intrinsic 300x150.

### Live refresh: visible only

60s poll, stopped dead when `document.visibilityState !== 'visible'`. An
admin page polling from a forgotten tab is how a Neon compute gets held
awake all night for nobody. Two more guards earned by trying it:

- The poll SKIPS while focus is in an input. A rebuild drops focus, and the
  filter box is the one thing on this page people type into.
- Table sort and filter live on the view's state object, not in the render
  closure. A table that silently re-sorted itself every 60 seconds would
  make the live refresh worse than no refresh.

New runs are diffed against the last poll by `trigram|points|at` (score_events
has an id, but analytics does not serve it) and each one pops a score bubble
over its territory.

### MT Roster health needs no new endpoint

Everything is computed from the analytics payload the page already fetches.
`top` rows carry `name` only when `rec_roster` matched, so **unmatched
trigrams are a filter, not a query** — and that list is the LKG case from
28 Sep, which until now could only be found by noticing a blank name on the
public board. Coverage is `roster count - matched`; the activity bands are
`last_seen` arithmetic.

**The one server change:** `roster.js` `op:'stats'` now takes
`requireScope(req, res, null)`. It returns a count and a timestamp, nothing
about any person, and the health page is `analytics` while `GRANTABLE` has
no `projects` — so demanding `projects` meant every staff member got a 403
where the headline number goes. Everything touching a ROW still wants
`projects`, and import is still manager-only.

The import itself moved off Maintenance, which now carries a pointer. Two
upload boxes for one table is how a stale one gets used.

Tour copy for both pages was rewritten — it described the old layout, and a
walkthrough that narrates a page that no longer exists is worse than none.

## Profiles and avatars (29 Sep 2026, schema v13)

Travis: "one of the biggest things I think we are missing is a personalized
Profile page. Think MySpace." Plus: upload a picture, put it beside the
Operations clock, and show it wherever a name appears.

**Most of this already existed and was misfiled.** `historyDialog()` in
projects.js was already a profile card — avatar, title, manager, OOO,
status, REC Room record, project list — under a name that says history,
reachable only by clicking a staff card. Status posts and emoji reactions
shipped in v8. Members could already set their own status and OOO. What was
missing was a ROUTE, a way to upload a picture, and faces anywhere else.

### Storage: the question answered with arithmetic

A 256×256 WebP avatar is 15–25KB. The whole SE team is a quarter of a
megabyte; all 891 roster people would be ~22MB. Blob on Pro includes 100GB
and the banner art already shares the store. Storage was never the
constraint — **Vercel's ~4.5MB request cap was**, and downscaling in the
browser removes it.

`avatar.js` `shrink()` centre-crops to a square and re-encodes at 256px
before anything leaves the page. Verified against the real pipeline: a
1.39MB PNG came out 2.5KB, `image/webp`, chunk `VP8X`, and
`uploadImage.js`'s magic-byte check and `imageDims()` both read it
correctly at 256×256. The square crop is not cosmetic — every one of these
renders as a circle, and scaling a 16:9 photo into one squashes the face.

### Who may upload

`uploadImage` took `requireScope('banners')`, so only the three people who
edit hero art could have a face. It now branches on `kind`: `'avatar'`
takes ANY valid key with a 400KB/1024px cap and an `avatars/` prefix;
`'banner'` is unchanged. 400KB is ~20× a correct upload — it exists only to
catch something that skipped the resize.

`members` op `'avatar'` joins OOO and status in `SELF_OPS`. Two rules worth
keeping: the URL must match the Blob host (a picture is uploaded here, not
linked from anywhere on the internet), and a manager may CLEAR someone's
picture but not choose one for them — moderation, not puppetry.

### The rule for names vs faces

Decided once, in `avatar.js`, so it cannot drift:

- a **chip** (board signature, reaction, project owner, direct report)
  shows the avatar ALONE, name on hover;
- **prose** (a change-log sentence) shows avatar AND name.

"🧑 retired a question" cannot be scanned for a person, and scanning is the
change feed's entire job. The default is a **person icon, not an initial** —
an initial reads as a broken image.

A sticky note and a change-log row store a TYPED NAME, not a member id, so
the face comes from matching that string against the registry
(`d.memberByName`). **A poster we cannot match keeps their written
signature** — never a blank face for someone we simply do not know.

### Home

- **Leadership Brief teaser removed.** It is a full page in the sidebar for
  exactly the people who can open it; a teaser was spending the best slot
  on the shortest trip.
- **Latest Changes moved to Maintenance.** A change feed is an audit trail,
  and the machine room is where you go looking for one.
- **Your face top right**, on the hotlinks line, hover for Update Avatar.
  It went into the Operations clock's title row first, which put it
  halfway down the page and read as a property OF the clock. An account
  belongs in the top right corner. It is a SIBLING of `.hlk-bar`, never a
  child: `loadHotlinks()` clears that element to repaint the pills and
  would take the avatar with it. At 44px only the camera fits, so the
  button carries a `title` as well.
- **Projects and REC Room now find YOUR rows.** Travis was explicit that
  this is *not* a page per person: "its the same home page for everyone…
  Their info just populates the widgets when they log in." There is no
  per-person Home URL. The linkable page is `#profile/:id`.
- A scoped key is not a person, so both cards fall back to the board's
  latest and a pointer at the scoreboard. SMEs and contractors hold those
  keys and the layout must not collapse into holes for them.

### Pieces that had to be shared

`shapeProjects(d, who)` came out of the Board's loader — Board, Staff,
Profile and Home all read the same bundle and all need the same lookups. A
second copy of "find a member by id" is how two pages start disagreeing
about who reports to whom. `giphyGrid()` came out of home.js for the same
reason: a sticker reaction on a profile and a sticker on the cork are now
the same picker.

`#profile` is routed with `nav: false` — reachable by hash, never listed.
You arrive by clicking a face, which is the point of putting faces
everywhere; a nav row would make it a destination instead.

### Two bugs this found, both worth remembering

**`Element.append()` renders a null child as the literal word "null".**
`h()` skips nulls, so every conditional child in this codebase is written
assuming that. The hover peek built its panel with `e.append(...)` and
printed "null" where an absent OOO note went. `put()` in avatar.js is the
filtered append; use it any time children are appended outside `h()`.

**`.av-row` was already taken.** The avatar upload row in
`editMemberDialog` has used that class since v6; a new rule further down
the sheet silently squashed it. The prose avatar+name row is `.av-line`.
Grep the stylesheet before naming a class in a file this long.

**A member session did not carry `avatar_url`.** Home's top-right corner
renders the signed-in person off `who.member` (from whoami), NOT off the
projects bundle every other face comes from — and that object was
`{id, name, trigram}`. So the one avatar the owner looks at most could
never show a picture, however many times they uploaded one. It looked
fine in-session because `pickAvatar` mutates the member object and
repaints; a refresh put the blank icon back. `auth.js` now selects
`avatar_url` in all three member tiers (`'' AS avatar_url` in the pre-v3
one, since the column arrives in v6). Worth remembering that whoami's
member object and the projects bundle's member rows are two different
shapes, and a field added to one does not reach the other.

**A route change never fires `mouseleave`.** The card that raised the hover
panel is simply gone, and the panel floats over the next page forever —
exactly the bug `hidePop()` already existed to fix. `draw()` now closes all
three: the player card, the avatar tooltip and the Staff peek.

### v13 needs Setup

`staff_status_reactions` gains `sticker_url` so a status takes a sticker or
GIF, not only an emoji — the same two-column shape `sticky_reactions` has
used since v4. `members.statusReact` falls back to an emoji-only insert on
a pre-v13 database and asks for Setup rather than silently posting a blank
reaction. The staffReacts select walks back one tier, per the house rule.

## Home reflow + Most Missed moves (29 Sep 2026, schema v14)

Travis's list, and what each one turned into.

**Both calendars, one widget.** Enablement runs two that share nothing:
Mission Control (learner-facing, `/api/command/events`, coloured by event
category) and Team (internal — phase deadlines, milestones, who is out,
coloured by project status). They are now tabs on the same card: same
grid, same month nav, only the source, the legend and the footer links
change. Tabs rather than two cards because they answer the same question
for two audiences, and two month grids stacked would push everything
below them off the page.

**Out-of-office has no date.** `ooo_note` is free text ("Back Thursday"),
so it cannot sit on a day cell. It lists under the grid instead.
Inventing a date to pin it to would be worse than not showing it.

**Names, renames and moves:** Action Banner → **AI Highlights** (label
only — the route stays `banners/stellar` so saved links survive). News →
**Learning Insights**, and it moved ABOVE the corkboard: it is one line
tall and the board is the tallest thing on the page, so below it the news
sat past the fold and nobody read it.

**The Stellar-Seller strip is gone.** It paired the hero banner set with
the arcade back when those were two brands; it is all just the REC Room
now. Its three parts went where each one belongs:

- the **score ticker** → its own card in the slot Learning Insights
  vacated, same column, same width;
- the **leaderboard** → merged into the REC Room card on the left, so
  "how am I doing" and "who is winning" are one glance instead of two
  trips down the page. Your own row is outlined and badged;
- **Most Missed** → onto the Questions page, next to the questions it is
  talking about.

### Most Missed, and the bug it uncovered

Every question row now carries a miss bar, and each bank gets a "Where
people need help" card on top. Colour is never the only signal: the
percentage sits beside the bar and the tooltip spells out the counts.
Rows under `minAttempts` still draw a bar but muted, labelled, and
excluded from the ranking — an SME should not rewrite a question because
one person fat-fingered it.

`.miss-row`'s label column is now CAPPED at 54ch. That list was born in a
narrow column inside the Stellar strip where `1fr` was the whole width; on
the full-width Questions card `1fr` grew to 1400px and stranded every bar
against the right edge, a screen away from the question it measures.

**The Methodology bank has never recorded a single answer stat.**
`methodology_questions.correct` is the ANSWER KEY — text `'a'|'b'|'c'|'d'`,
predating the Control Room — so migrate's
`ADD COLUMN IF NOT EXISTS correct integer` has always been a silent
no-op. `checkCoinAnswer` then ran
`SET attempted = attempted + 1, correct = correct + 1`, which Postgres
rejects (no `text + integer` operator), and its own `catch (e) {}` ate the
error. **Both** counters were lost, not just one, which is why that bank
never appeared in Most Missed at all — `questionStats` filters on
`attempted > 0`.

v14 adds `correct_count`, a name that cannot collide. Counting starts at
deploy; there is nothing to backfill, and the Questions page says so on
that tab rather than showing an empty chart. Lesson worth keeping: a
non-fatal `catch` around a stats write will hide a schema mistake
indefinitely — nothing was broken from the outside, the number was just
always zero.

### Not built: the per-region breakdown

"NAM is missing xyz and LATAM is missing abc" needs data that does not
exist. The counters live ON the question row as two integers; there is no
per-answer record, so there is nothing to group by territory. Doing it
means a new `question_answers` table (question, table, territory, correct,
when) and an INSERT on **every answer in the game** — a write on the hot
path that currently does one cheap UPDATE. That is a real cost and a real
design decision, so it is Travis's call, not a thing to slip in.

## GSE Central, project pages, Leadership Access (29 Sep 2026, no schema)

**Mindtickle Calendar** — the learner-facing one, named plainly now that a
Team calendar exists beside it on Home. **GSE Central** (was Insights &
Calendar) leads the Projects group: the section's front door, with the
Board one step in. Landing on the summary and stepping into the editor
reads better than the reverse.

### The Team Member Catalog is gone

Travis: the enablement org has no named internal sub-teams, who reports to
whom is the Staff page's job, and everyone ends up on everything. A
catalog grouped by team — and the "By team" donut beside it — charted a
structure nobody actually works by. Both are deleted.

What replaced them is the split that DOES drive the work: **Who is on
what**, person level, ordered by load, every face a door to that person
and every project chip a door to the project. Plus a **Projects index** —
the page had four visualisations OF the board without ever showing the
board.

### A project is a page now

`#project/<id>`, `nav:false`, reached by clicking a project's name
anywhere (Home, Profile, GSE Central) or Open on a board row. Status,
milestones and the full diary on one screen. Before this the material was
behind two modal doors — a Diary button inside a board row — and there was
no link you could send anyone.

Class prefix is **`prp-`, not `pp-`**: pop.js owns `.pp-*` for the player
stat card. That is the third namespace collision in two days (`.av-row`,
`.pp-*`) — grep the stylesheet before naming a class in a file this long.

### Leadership Access

A sidebar group gated on `master || manager`, holding the Leadership Brief
and Maintenance. Both were already manager-gated and both were filed
somewhere misleading: the Brief sat under Projects next to pages the whole
team opens, and Maintenance sat in "System" keeping company with Help &
FAQ, which everyone can open. System now holds only Help — the last group
is the one thing everyone can reach.

**Tailored Access deliberately stays under Projects.** Staff granted
`access` hold a read-only view of it, and a manager-only group would hide
it from exactly the people the `access` scope was invented for.

The Brief opens with a **verdict in words** — "1 promise already broken",
"nothing overdue but 2 recorded no activity" — then tiles, then a
moved/quiet/overdue split, then the written sections unchanged. It used to
open with one grey sentence of six numbers run together, which is a report
you have to parse before you can read it.

### The donut has never drawn its ring

Found while checking the new layout. `donut()` built an inline SVG with a
viewBox and no width/height; `.donut-face` is `flex:none` with no
dimensions of its own, so the element measured **0x0** and the arcs never
rendered. The centre label and the legend drew on top of nothing, which
read as "a donut with no donut" rather than as a broken chart — which is
presumably why it survived this long.

Fixed at the source (`width`/`height` from the `size` parameter, plus
`display:block`). `.donut-face` also took `line-height:0` so the SVG sits
flush, which meant `.donut-center` had to put its own leading back or the
two centre lines printed on top of each other. Same family as the REC
map's fx canvas: **a replaced element with no intrinsic size collapses,
and nothing errors.**

## Route matching must not depend on nav order (29 Sep 2026)

Moving GSE Central to the top of the Projects group silently broke
`#projects/new` — Home's "New project" action. `findItem` had two rules,
exact match then "first item whose head segment matches", and with
`projects/insights` now listed before `projects`, the prefix rule caught
it first and opened GSE Central instead of the board.

A third rule sits between them now: **a route that IS the head wins over
a sibling that merely shares it.**

```
1. exact            projects/insights
2. route === head   projects/new      → projects        (the Board)
3. head prefix      banners/stellar/new → banners/highlights
```

Rule 3 is still needed and still correct: there is no route called
`banners`, and banners.js reads the board off `params[0]`, so both boards
deliberately land on one item. Same for `questions/<table>`.

Verified by asserting 15 deep links land on the page they name, and by
walking 25 routes (including junk and missing ids) with an error trap
attached — zero thrown.

**The lesson is the shape, not the fix:** any matcher whose result
depends on declaration order will break the first time someone reorders
the list for cosmetic reasons, and it breaks silently, because landing on
the wrong page is not an error.

Two pieces of copy also went stale in the same move and were corrected:
the Home tour still pointed a step at the change feed after it moved to
Maintenance (findStep filters missing targets out silently, so the step
just vanished), and the banner editor still told people it was writing to
"the Stellar widget".

## Locked nav rows, Authority & Control, timelines (29 Sep 2026, schema v15)

### Show the door, lock the door

Every nav item is listed now, whether or not the person can open it. A
locked row is greyed, carries a padlock, and explains itself on hover.

Travis's reason is the whole justification: hiding an area meant a staff
member could not tell *"CAPCOM has no calendar"* from *"the calendar is
not mine to edit"*, and the second one looks like a bug. Nobody files a
ticket about a padlock.

A locked row is **not an anchor** — no `href`, no route in the hash — so
clicking it cannot navigate. `findItem` still filters on `allowed`, and
`requireScope` still guards every endpoint. **This is signposting, never
permission.**

`lockedWhy()` says what to ask for in the words the Staff page uses, and
deliberately does NOT name a scope the reader cannot be granted:
`projects` and `system` are absent from `GRANTABLE`, so "ask a leader to
tick projects" would send someone to a leader who has no such checkbox.
Gated items say "held by the leadership circle" instead.

The hover panel is **one fixed node for the whole sidebar**. As a child of
the row it lived inside `.nav` (`overflow-y:auto`), which clipped it at
the sidebar edge AND gave the sidebar a horizontal scrollbar. Third time
this pattern has come up (`#av-tip`, `#staff-pop`, now `#nav-tip`): a
floating panel inside a scrolling container is always wrong.

### Authority & Control

Renamed from Leadership Access, and **Tailored Access moved into it**.
The earlier reason for keeping it under Projects — staff granted `access`
would lose sight of it — evaporated the moment locked rows became
visible, because now they see it either way.

The group itself no longer gates; its items do. Everyone sees the tier
exists, which is the point of naming it.

### Timelines

`timeline_posts` + `timeline_reactions`. Three kinds, deliberately the
corkboard's three (text / link / sticker) because people already know how
those behave there.

**`op:'post'` takes no member_id and that is the authorization model.**
You cannot post as someone else because the endpoint never reads who you
claim to be — it writes to `who.member.id` or refuses. Reads are open to
any valid key (walls are as public as the Staff page); writes need a
member session, since a scoped key is not a person and has no wall.

Takedown is a soft delete, so reactions keep their anchor and a mistake
is reversible in SQL. Stickers must match the GIPHY host on both posts
and reactions — otherwise a "sticker" is an arbitrary remote image embed
on a page everyone loads.

Home's widget shows `DISTINCT ON (member_id)` — the newest post per
person, not the newest posts overall, so one busy week cannot fill the
rotation. It pauses on hover, and clamps text to two lines so no single
post makes the card taller than Learning Insights beside it.

## An empty state that hides is indistinguishable from a bug (29 Sep 2026)

The team-timeline widget shipped, found an empty feed on its first day —
because nobody had posted yet — and **removed itself**. Travis's read was
the only available one: "you've missed the widget."

`feedCard()` now always renders. Empty, it says what to do and links to
the profile. It removes itself under no circumstance; a failed fetch says
the feed is not answering.

The rule generalises to every optional card in CAPCOM. `card.remove()` on
empty is fine for something that has ALWAYS been there and is
occasionally quiet (Learning Insights, the score ticker). It is wrong for
something brand new, because day one IS the empty case and the person who
asked for it is looking for it.

## The feed is all three places people speak (29 Sep 2026)

Travis: "the latest team comments, posts, and **social media stuff**."
The first version read `timeline_posts` alone. A wall post, a status and
a note on the corkboard are the same gesture from the reader's side, and
a rotation fed by one of the three sits empty while the other two fill.

`op:'feed'` now unions:

| source     | from                          | tag           |
|------------|-------------------------------|---------------|
| `timeline` | `timeline_posts`              | posted        |
| `status`   | `team_members.status_text`    | status        |
| `board`    | `stickies` (notes + bookmarks)| on the board  |

Each sub-wrapped — one missing table degrades the feed, never 500s it.
`DISTINCT ON (member_id)` **per source**, so one person's busy week cannot
crowd out everyone else.

Board stickers are excluded: they expire after 24h and are decoration
rather than something said. The corkboard join is on `lower(poster_name)
= lower(name)` because a sticky stores a TYPED STRING; an SME on a scoped
key keeps their typed name and simply has no avatar and no profile link.

The widget tags each item with where it came from rather than flattening
all three, and shows position dots so it reads as a rotation instead of a
card that changes by itself.

## Threads, Trophy Cases, GSE Central rebuilt (29 Sep 2026, schema v16)

Travis framed the whole thing: *"I just want folks to be able to see the
data we have access to… in a friendly team-building way, not an overlord
way. But the end result (for Nick's end) needs to be similar… so if he
has to go to bat for our org on the next round of layoffs, I want to give
him as many legs to stand on."*

That is the design constraint, not decoration. Everything below records
what people CHOSE to put forward, never what was measured about them.

### Threads: click anything anyone said

`op:'thread'` returns one post or status with its reactions and comments.
`target_kind` is `'post'` (a `timeline_posts.id`) or `'status'` (the
member id — a person has exactly one status). One polymorphic key rather
than two tables: a comment is a comment, and the thread UI should not
care which wall it hangs under.

**No reacting to your own.** The client hides the buttons and shows
"Reactions to your post" instead; `op:'react'` refuses it server-side,
which is what actually holds. **Commenting on your own is allowed** —
adding an update under your own thread is how a wall normally works, and
only self-applause is silly.

This needed `member_id` on both reaction tables. They recorded a NAME
only, so "is this mine" was unanswerable. 0 = a scoped key with no person
behind it, which owns nothing and is therefore unaffected.

### The Trophy Case

`project_trophies`, on every project page. Four kinds — win, praise
(what somebody else said), shot (a screenshot through our own uploader),
link.

**Deliberately not the diary.** The diary is the record, mostly written
by the system; this is the highlight reel, written only by people.
Mixing them buries the wins in an audit trail, and an audit trail is not
what anyone wants to read when asked what the team has done.

Posting is limited to people TAGGED on that project, plus managers, and
that is enforced server-side. A case anyone can fill is a noticeboard;
the point is that it belongs to whoever did the work. Screenshots must
come from our Blob — accepting any URL would put an arbitrary remote
image on a page the whole org loads.

### GSE Central, to Travis's layout

```
row 1   Projects Calendar   |  Projects Overview
row 2   Projects (index)    |  Phase Timeline
```

**Projects Overview** folds the counts, the status donut and who-is-on-
what into one frame. It is NOT called GSE Central: a card repeating the
page's own name told the reader nothing.

**Row 2 is linked by hover.** Hovering a project lights its bar in the
timeline (`data-pid` on both sides — a lookup, never a redraw, because
the timeline must not rebuild sixty times while a cursor runs down the
list) and raises its three most recent updates beside the cursor.

**Diary Review is gone.** It reprinted every entry for every project
here, which made this page long and the project page redundant. The
hover card shows the latest three; the project page holds the rest, in
its own scrolling frame.

`buildReview()` is left in place and marked unreachable rather than
deleted — same treatment as `historyDialog`.

## A hidden control is a broken control (29 Sep 2026)

Travis: "The right click to react to status updates and posts arent
working." Nothing was broken. Production held exactly **one** piece of
social content — his own status — and zero timeline posts. The self-react
rule correctly hides the button on your own, so the only status on the
page had no affordance and nothing explaining why.

The rule stays; the silence goes.

- Your own status/post now shows a dashed **"yours"** chip where the
  react button would be, and says so on hover.
- Every status gets a **💬** that opens its thread, yours included —
  before this there was no visible way in at all, only an unhinted click
  target on the quote itself.
- Home's rotation, when the only item is yours, says so in a line rather
  than looking like a widget that will not advance.

Generalise it: **whenever a control is hidden by a rule, render the rule.**
A missing button and a dead button are the same pixel.

## `open(path,"w")` truncates before it can fail (29 Sep 2026)

A patch script hit `UnicodeEncodeError` mid-`write()` and left
`CAPCOM/js/views/staff.js` at **zero bytes** — the file had already been
truncated by the open, and the exception killed the write. Recovered with
`git checkout --`, which is the argument for committing before a batch of
scripted edits, not after.

Every patch helper in this repo now encodes FIRST and writes bytes:

```python
data = s.encode("utf-8")   # raises here, before anything is destroyed
io.open(path, "wb").write(data)
```

The trigger was a surrogate pair written as `\ud83d\udcac` in a Python
source string. Python keeps lone surrogates in `str` and only rejects
them at encode time. Emoji above U+FFFF go in as a single `\U0001f4ac`.

## The corkboard moved to board.js (1 Oct 2026)

Travis asked for the Community Board and the Community Feed to be
mirrored on GSE Central. "Mirrored" has exactly two implementations: one
module mounted twice, or two copies that drift. So the corkboard — ~840
lines with its own state for board number, z-order, yarn, transforms,
context menus and the audio pops — came out of home.js into
`CAPCOM/js/board.js`.

**Module state is shared on purpose.** Switch to board 3 on Home and GSE
Central is on board 3 too, because it IS the same board. That is what
mirrored means.

The board had two dependencies on its host, and only two: the signer's
name (it signs every note with a real name) and the member registry (it
turns a typed `poster_name` into a face). Both now arrive through
`boardViewer({ me, people })` before the mount. `people` is a PROMISE, so
GSE Central — which already has the bundle in hand — passes a resolved
one rather than fetching the same payload twice.

Ordering caught me once: home.js called `boardViewer` on the line ABOVE
the one that assigns `PEOPLE`, handing it null. It now runs after.

## Team Timeline is the Community Feed, in two shapes (1 Oct 2026)

Renamed throughout. One payload, two renderings in one module, because
the two pages have different amounts of room:

- `feedCard()` — **Home.** One band, one item at a time, fading. It
  shares a column with the clock and the corkboard and has no height.
- `feedList()` — **GSE Central.** A thread: newest first, scrolling
  inside its own frame, each row showing who/when/where-from and
  clicking through to the same reaction-and-comment dialog. Travis asked
  for "a reddit thread feel or a feedback news feed".

A **board note has no thread** — it lives on the corkboard — so its row
links to the board instead of opening a dialog that would have nothing
in it.
