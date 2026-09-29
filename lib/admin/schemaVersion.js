/* The schema version this DEPLOY expects. Bump it by one every time
   migrate.js gains DDL or seeds. migrate stamps it into app_state on
   success; whoami compares stamp vs code and tells the client, which
   shows the "update the app" banner to the leadership circle (system
   scope, or a team leader signed in as a member). That banner is the
   whole reason this constant exists — nobody should have to REMEMBER
   to run Setup. */
export const SCHEMA_VERSION = 16;

/* What each version deployed, newest first — terse, human bullets. The
   update banner shows the pending versions' notes; the sidebar version
   chip shows the whole list to any key holder. RULE: when you bump
   SCHEMA_VERSION, add its entry here in the same commit. */
export const DEPLOY_NOTES = [
  { v: 16, notes: [
    'Click any post or status to open it \u2014 reactions and comments in one place',
    'You can comment on your own posts but not react to them; you still see everything others leave',
    'Every project page now has a Trophy Case: post a win, a screenshot, or something a colleague said',
    'GSE Central rebuilt \u2014 Projects Overview beside the calendar, and the phase timeline lights up the project you are hovering',
  ] },
  { v: 15, notes: [
    'Timelines: post text, links and stickers to your own profile, and react to anyone\u2019s',
    'A rotating widget on Home shows the newest post from around the team',
    'Areas you cannot open are now shown greyed with a padlock instead of hidden \u2014 hover one to see what to ask for',
    'Leadership Access is now Authority & Control, and Tailored Access moved into it',
  ] },
  { v: 14, notes: [
    'Coin (Methodology) questions now record answer stats — they never have, silently, so that bank starts counting from this update',
    'Most Missed moved off the Home page and onto Questions, with a miss bar on every row',
  ] },
  { v: 13, notes: [
    'Profile pictures: upload your own from the avatar beside the Operations clock, or from your profile — it then follows you everywhere your name appears',
    'Profiles are now a real page (click any face) with your status, reactions, projects and REC Room record in one place',
    'Status posts take sticker and GIF reactions, not just emoji',
    'Home: Leadership Brief moved to the sidebar only, Latest Changes moved to Maintenance, and Projects + REC Room now show YOUR work',
  ] },
  { v: 12, notes: [
    'Staff access is no longer all-or-nothing: grant Calendar, Hero Banners, Questions or Analytics to any team member from their Staff row',
    'Managers are unchanged and still hold everything; Maintenance and key minting stay manager-only and cannot be granted this way',
  ] },
  { v: 11, notes: [
    'Retiring a question now starts a 48-hour clock — a countdown ring fills on its Edit button, and once it runs out the row is deleted for good',
    'Restore inside the window and the clock clears; after that the question and its attempted/correct history are gone',
    'Questions already retired before this update get a fresh 48 hours from the moment Setup runs',
  ] },
  { v: 10, notes: [
    'Multi-day events: give an event an end date and it spans the calendar (Connect, SKO, protected seller time)',
    'Click an empty day on the calendar preview to create an event on that date',
  ] },
  { v: 9, notes: [
    'The whole SE team is staff-tagged (off every leaderboard, in-game ones included) and seeded into the org tree under their leaders',
    'Players is now MT Roster and lists everyone, not the top 50',
  ] },
  { v: 8, notes: [
    'Staff board: informal status posts (a quote, a joke) with reactions — editing or deleting a post wipes it and its reactions forever',
  ] },
  { v: 7, notes: [
    'REC roster: hovering a scoreboard trigram shows the player’s name, title and flag (import the roster under Maintenance)',
  ] },
  { v: 6, notes: [
    'Staff profiles: brand avatars, REC Room performance, out-of-office notes (members set their own)',
    'Leadership Brief: week/month/quarter from the board, optional Claude executive summary',
  ] },
  { v: 5, notes: [
    'Invites record who sent them; the feed says so on redemption',
    'Members sign board notes, stickers and reactions automatically — no typed name',
  ] },
  { v: 4, notes: [
    'Invite-only member access: managers issue one-time codes; passwords need 10+ chars with a number and a symbol',
    'First-run guided walkthrough with Help & FAQ',
  ] },
  { v: 3, notes: [
    'Manager tier: seven named managers hold every scope and are the only ones who sign the team up, reset codes, and grant manager access',
  ] },
  { v: 2, notes: [
    'Staff: people-leader declaration and reporting lines (staff below their leader)',
  ] },
  { v: 1, notes: [
    'Projects tracker: board, statuses with dates, overdue logs, diary',
    'Insights: Gantt, donuts, projects calendar, quarter review',
    'Team member registry, project tagging, person history',
    'Member sign-in with self-set access codes; leaders can run Setup',
    'Team Member Catalog with team-leader hierarchy',
    'Community Board: yarn ties, bookmarks, signed notes, light theme',
    'Enablement News feed (sales enablement × AI)',
  ] },
];
