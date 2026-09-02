/* The schema version this DEPLOY expects. Bump it by one every time
   migrate.js gains DDL or seeds. migrate stamps it into app_state on
   success; whoami compares stamp vs code and tells the client, which
   shows the "update the app" banner to the leadership circle (system
   scope, or a team leader signed in as a member). That banner is the
   whole reason this constant exists — nobody should have to REMEMBER
   to run Setup. */
export const SCHEMA_VERSION = 1;
