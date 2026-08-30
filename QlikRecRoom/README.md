# The REC Room

The Qlik Sales Enablement arcade: sign in with your trigram, play
**Side-Qlik Blitz**, and put your territory on the map.

## The pieces

- **`index.html`** — the desktop room. One page, many faces: `?section=`
  picks what a given Mindtickle widget shows (banner, game, play,
  scoreboard, launch, cartridges), so several widgets share one file
  without forking it.
- **`mobile.html`** — the room, mobile-first. One file, two renders: framed
  inside Mindtickle it is a single launch card sized for the widget crop;
  opened at top level it is the full room — badge, play, scoreboard.
  Installable via Add to Home Screen (on iPhone that is the only route to
  true full screen, and it nearly doubles the play area).
- **`games/SideQlik_Blitz/`** — the game. Aim, fire, clear DORCs; real
  enablement content drives the scoring: knowledge questions, methodology
  coins (bank three for Methodology Madness), and glossary Brain Blasts.
  Colors unlock as your territory's best runs climb.

## How scores work

Identity is a self-declared three-letter trigram — deliberately not wired
to any Qlik system. Scores post to the shared leaderboard with server-side
plausibility caps (score ceiling scales with time actually played), and the
territory map celebrates recent runs. Practice mode always works; banking
points requires the room's session key, which lives in the Mindtickle
widget URL — not in this repo.

## Notes for whoever touches it next

The engineering log in the repo root's `CLAUDE.md` is the authority —
especially the Mindtickle iframe constraints (hand-measured heights, the
~200px mobile crop, fullscreen policy) and the auth/score-integrity
section. The desktop and mobile pages intentionally duplicate a few
literals (country list); if you change one, change both.
