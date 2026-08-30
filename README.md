# QlikGSE

The Qlik Sales Enablement platform — a family of small, fast, zero-build web
apps that live inside (and behind) the team's Mindtickle home page.

**Live chain:** GitHub → Vercel → Mindtickle Custom HTML widgets → browser.
Push to `main` and it deploys. There is no bundler, no framework, and no build
step anywhere in this repo — every page is hand-written HTML, CSS, and vanilla
ES modules, served as-is.

## What's in here

| App | Where | What it does |
|---|---|---|
| **Mission Control** | `SalesCommand/` | The Mindtickle home-page widgets: rotating headline banners, the team calendar and key-date chips, glossary, market ticker, and the Stellar-Seller action banner. Content is served from the database, edited in CAPCOM. |
| **The REC Room** | `QlikRecRoom/` | The team arcade — badge, scoreboard, live territory map, and the game cabinet. Ships desktop (`index.html`) and mobile-first (`mobile.html`) front ends over the same API. |
| **Side-Qlik Blitz** | `QlikRecRoom/games/SideQlik_Blitz/` | The game itself: an arcade shooter wired to real enablement content — knowledge questions, methodology coins, and glossary Brain Blasts feed scoring, with territory-based color unlocks and a global leaderboard. |
| **CAPCOM** | `CAPCOM/` | *Content, Analytics & Players — Command Operations Module.* The admin console: calendar and banner editors, question banks, player analytics, maintenance switch, scoped access keys, and the Community Board — sticky notes, stickers, website bookmarks, and colored yarn tying ideas together. Responsive down to a phone. |

## Architecture in one paragraph

Serverless functions on Vercel (`api/*.js`) route by namespace into `lib/`
(`blitz`, `command`, `recroom`, `admin`) — thin routers over one file per
action, backed by Neon Postgres. The front ends are static pages that fetch
those APIs. Identity in the REC Room is a self-declared trigram; access to
CAPCOM is by scoped keys that fail closed. Everything user-visible degrades
gracefully: feeds fall back to shipped content, maintenance mode fails open,
and no secret ever appears in a URL or in this repo.

## Working on it

Read `CLAUDE.md` first — it is the living engineering log: the section
system, the Mindtickle iframe constraints, auth and score integrity, and
every gotcha that has cost real time. The short version:

- Edit the committed HTML/JS directly; a browser reload is the dev loop.
- Parse-check every touched file before pushing (`node --check`) — a syntax
  error in one `lib/` file takes down its whole API namespace, and Vercel
  will not fail the build for it.
- The only npm dependency is `@neondatabase/serverless`.

## License

[Apache 2.0](LICENSE). Built by Travis Slusser for the Qlik Sales Enablement
team.
