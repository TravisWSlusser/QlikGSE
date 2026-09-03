/* The schema version this DEPLOY expects. Bump it by one every time
   migrate.js gains DDL or seeds. migrate stamps it into app_state on
   success; whoami compares stamp vs code and tells the client, which
   shows the "update the app" banner to the leadership circle (system
   scope, or a team leader signed in as a member). That banner is the
   whole reason this constant exists — nobody should have to REMEMBER
   to run Setup. */
export const SCHEMA_VERSION = 6;

/* What each version deployed, newest first — terse, human bullets. The
   update banner shows the pending versions' notes; the sidebar version
   chip shows the whole list to any key holder. RULE: when you bump
   SCHEMA_VERSION, add its entry here in the same commit. */
export const DEPLOY_NOTES = [
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
