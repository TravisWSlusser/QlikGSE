import { sql, requireScope, cors } from './auth.js';
import { SCHEMA_VERSION } from './schemaVersion.js';

/*
  POST /api/admin/migrate — creates every table the Control Room needs and
  seeds the content tables from what the pages ship hardcoded today, so the
  first thing a leader sees in the app is the live site's real content, not
  an empty screen.

  Idempotent on purpose: CREATE TABLE IF NOT EXISTS throughout, and seeding
  only fires into an EMPTY table — re-running after content has been edited
  changes nothing. Safe to hit as many times as anyone likes.

  This also finally creates app_state, which the maintenance switch has been
  reading against (and failing open without) since launch.

  Master/system only. Nothing here reads request input, so there is nothing
  to validate — the whole body is ignored.
*/

const SEED_CATEGORIES = [
  ['training', 'Training',     '#10CFC9'],
  ['deadline', 'Deadline',     '#FF6B6B'],
  ['event',    'Live Event',   '#00A651'],
  ['content',  'Content Drop', '#9B59FF'],
];

/* Verbatim from SalesCommand/assets/calendar/events.json at migration time.
   month/day are not stored — /api/command/events derives them from date. */
const SEED_EVENTS = [
  { date: '2026-08-17', category: 'training', title: 'Q3 Certification opens',
    detail: 'Built to Win goes live. Q1 gave you the message, Q2 the story; Q3 turns both into strategic proposals.' },
  { date: '2026-08-20', category: 'event', title: 'Move to Cloud Update',
    detail: 'Where the Qlik Talend Cloud motion stands, the Precog to Stitch shift, and what Sales, BDRs, SEs and CSMs do next.',
    full: 'This session brings the field up to speed on the Move to Cloud Program and the initiatives driving the Qlik Talend Cloud motion. We’ll open with a product marketing view of the latest QTC connectivity milestone — the shift from Precog to Stitch, which now supports the full range of use cases including Replication, pipelines, and OLH — covering what’s releasing, who it affects, and why it matters to both customers and Qlik. From there, we’ll go deeper into the technical detail of the Move to Cloud program itself. Attendees will leave knowing the specific actions expected of Sales, BDRs, SEs, and CSMs, and what we want customers to do next.' },
  { date: '2026-09-01', category: 'event', title: 'Sparks: Get More — Notetaker',
    detail: 'Second session in the Accelerate Pipeline with AI series, on Mindtickle Notetaker — working sessions co-led by your field colleagues on how they’re actually using these tools on live deals. 10:00-11:00 AM. Zoom link and full agenda to follow.' },
  { date: '2026-09-03', category: 'event', title: 'Sparks: Open Lakehouse Update',
    detail: 'What’s New, What’s Next, What’s In It For You. The newly released Replicate Source for Open Lakehouse, the upcoming Open Lakehouse on Google Cloud launch, and how to position it as an ingestion and cost play rather than a rip-and-replace. 10:00-11:00 AM.',
    full: 'Open Lakehouse capability is expanding — and there’s real money on the table for sellers who know how to position it properly. Join this session for a fast-paced update on where Open Lakehouse stands in the market today, plus two big pieces of news you can take straight to customers: (1) the newly released Replicate Source for Open Lakehouse — existing Replicate customers can now write straight into Iceberg, no pipeline rebuild required; and (2) the upcoming Open Lakehouse on Google Cloud launch. We’ll also cover where Open Lakehouse fits alongside AWS, Google Cloud Platform, Snowflake and Databricks, and how to talk about it as an ingestion and cost play rather than a rip-and-replace. Come ready with your questions. This is your shortcut to sounding sharp on Open Lakehouse in front of customers in time for Q4.',
    link: 'https://qlik.zoom.us/j/92137971282?pwd=ck1jsgUZNca8G3I8jurvkFNPRmC5uA.1' },
  { date: '2026-09-08', category: 'event', title: 'Sparks: Get More — Deal Guides',
    detail: 'Third and final session in the Accelerate Pipeline with AI series, on Deal Guides — working sessions co-led by your field colleagues on how they’re actually using these tools on live deals. 10:00-11:00 AM. Zoom link and full agenda to follow.' },
  { date: '2026-09-14', category: 'deadline', title: 'Q3 Certification due',
    detail: 'Final day to complete the Built to Win Q3 certification.', pin: true },
];

/* Verbatim from the HIGHLIGHTS array in qlikmt-hero.html and STELLAR_POSTS
   in stellar.html. title is raw HTML by contract — <span class="ac"> is the
   green accent word. */
const SEED_BANNERS = [
  { board: 'highlights', sort: 0, kicker: 'New Release', date_text: 'August 14, 2026',
    title: 'Deal <span class="ac">Guides</span>.',
    body: 'Bring opportunity context, call insights, next best actions and relevant resources together in one place. Create one now in Rooms &mdash; ‘Deals &amp; Contacts’.',
    ctas: [] },
  { board: 'highlights', sort: 1, kicker: 'Q3 Certification', date_text: 'August 14, 2026',
    title: 'Built to <span class="ac">Win</span>.',
    body: 'Q1 gave you the message. Q2 gave you the story. Q3 teaches you to use both to build and win strategic proposals from the very first interaction.',
    ctas: [{ label: 'Get started here', href: 'https://deeplinks.mindtickle.com/cVEDWXR7D3b' }] },
  { board: 'highlights', sort: 2, kicker: 'Now Live', date_text: 'August 14, 2026',
    title: 'New Hubs <span class="ac">structure</span>.',
    body: 'Your starting point for trusted sales content: from preparing for customer conversations to positioning Qlik, proving value and progressing opportunities.',
    ctas: [{ label: 'Explore here', href: 'https://deeplinks.mindtickle.com/egJ5KkSP84b' }] },
  { board: 'stellar', sort: 0, kicker: 'The Universe',
    title: 'Stellar-Seller <span class="ac">and the Side-Qlik</span>.',
    body: 'Everything AI-knowledge in one place — the comic, the AI Academy, and the REC Room. Start anywhere.', ctas: [] },
  { board: 'stellar', sort: 1, kicker: 'Now Playing',
    title: 'Side-Qlik <span class="ac">Blitz</span>.',
    body: 'Clear the board, answer under pressure, and put your territory on the map. Live in the REC Room.', ctas: [] },
  { board: 'stellar', sort: 2, kicker: 'AI Academy',
    title: 'Learn the <span class="ac">tools</span>.',
    body: 'Practical AI for sellers — what to use, when to use it, and the prompts that actually move a deal.', ctas: [] },
];

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  // Setup is for the leadership circle: system-scope keys, plus any member
  // session whose person LEADS an active team (project_teams.leader_id).
  // Migrate is additive and idempotent by construction — a leader keeping
  // the app current cannot break anything with it.
  const who = await requireScope(req, res, null);
  if (!who) return;
  if (!who.scopes.includes('system')) {
    let isLeader = false;
    if (who.member) {
      try {
        const lead = await sql`SELECT id FROM project_teams
          WHERE active = true AND leader_id = ${who.member.id} LIMIT 1`;
        isLeader = lead.length > 0;
      } catch { /* registry not there yet — leaders can't exist either */ }
    }
    if (!isLeader) {
      return res.status(403).json({ error: 'Setup takes the system scope, or being a team leader' });
    }
  }

  const done = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS event_categories (
      key   text PRIMARY KEY,
      label text NOT NULL,
      color text NOT NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS events (
      id         serial PRIMARY KEY,
      date       date NOT NULL,
      category   text NOT NULL,
      title      text NOT NULL,
      detail     text NOT NULL DEFAULT '',
      full_copy  text NOT NULL DEFAULT '',
      link       text NOT NULL DEFAULT '',
      pin        boolean NOT NULL DEFAULT false,
      active     boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS banners (
      id         serial PRIMARY KEY,
      board      text NOT NULL,
      kicker     text NOT NULL DEFAULT '',
      title      text NOT NULL,
      body       text NOT NULL DEFAULT '',
      date_text  text NOT NULL DEFAULT '',
      ctas       jsonb NOT NULL DEFAULT '[]',
      image_url  text NOT NULL DEFAULT '',
      sort       integer NOT NULL DEFAULT 0,
      active     boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_keys (
      key        text PRIMARY KEY,
      label      text NOT NULL,
      scopes     text[] NOT NULL,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used  timestamptz
    )`;
    // The maintenance switch's long-missing table, exactly per the runbook.
    await sql`CREATE TABLE IF NOT EXISTS app_state (
      key        text PRIMARY KEY,
      value      text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`INSERT INTO app_state (key, value) VALUES
      ('maintenance', 'off'),
      ('maintenance_message', 'The REC Room is closed for a short update.'),
      ('maintenance_eta', '')
      ON CONFLICT (key) DO NOTHING`;
    // The change feed behind the Home screen's "latest changes".
    await sql`CREATE TABLE IF NOT EXISTS admin_log (
      id         serial PRIMARY KEY,
      actor      text NOT NULL,
      action     text NOT NULL,
      summary    text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    // Per-question answer counters, bumped by the game's check endpoints.
    // ADD COLUMN IF NOT EXISTS because these tables predate the Control
    // Room. Counting starts the moment the columns exist — there is no
    // historical per-question data to backfill.
    await sql`ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS attempted integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS correct integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE methodology_questions
      ADD COLUMN IF NOT EXISTS attempted integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS correct integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE glossary_terms
      ADD COLUMN IF NOT EXISTS attempted integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS correct integer NOT NULL DEFAULT 0`;
    // Cumulative playtime per player — logScore adds each run's (capped)
    // durationSec. Like the question counters: counts from creation forward.
    await sql`ALTER TABLE players
      ADD COLUMN IF NOT EXISTS play_seconds bigint NOT NULL DEFAULT 0`;
    // The staff flag — the column upgrade lib/excluded.js always named as
    // the right answer. Seeded ONCE from the old constant (guarded by an
    // app_state marker so a later un-tagging is never re-applied by Setup).
    await sql`ALTER TABLE players
      ADD COLUMN IF NOT EXISTS staff boolean NOT NULL DEFAULT false`;
    const seeded = await sql`SELECT 1 FROM app_state WHERE key = 'staff_seeded' LIMIT 1`;
    if (!seeded.length) {
      await sql`UPDATE players SET staff = true WHERE trigram IN ('TVO', 'LND')`;
      await sql`INSERT INTO app_state (key, value) VALUES ('staff_seeded', '1')
        ON CONFLICT (key) DO NOTHING`;
      done.push('seeded staff flags');
    }
    // The shared quick-links bar on CAPCOM's Home. No seeds — Travis fills it.
    await sql`CREATE TABLE IF NOT EXISTS hotlinks (
      id         serial PRIMARY KEY,
      label      text NOT NULL,
      href       text NOT NULL,
      sort       integer NOT NULL DEFAULT 0,
      active     boolean NOT NULL DEFAULT true,
      created_by text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    // The community corkboard — digital sticky notes on CAPCOM's Home.
    await sql`CREATE TABLE IF NOT EXISTS stickies (
      id         serial PRIMARY KEY,
      message    text NOT NULL,
      detail     text NOT NULL DEFAULT '',
      color      text NOT NULL DEFAULT 'yellow',
      author     text NOT NULL DEFAULT '',
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE stickies
      ADD COLUMN IF NOT EXISTS sticker_url text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS poster_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS rotation integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scale real NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS board_no integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS pos_x real,
      ADD COLUMN IF NOT EXISTS pos_y real,
      ADD COLUMN IF NOT EXISTS link_url text NOT NULL DEFAULT ''`;
    // Reactions stuck to notes' corners — emoji or a small sticker, signed.
    await sql`CREATE TABLE IF NOT EXISTS sticky_reactions (
      id          serial PRIMARY KEY,
      sticky_id   integer NOT NULL,
      emoji       text NOT NULL DEFAULT '',
      sticker_url text NOT NULL DEFAULT '',
      name        text NOT NULL,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`;
    // Yarn: colored string tying two board items together — the conspiracy
    // wall's connective tissue. Shared state, like transforms.
    await sql`CREATE TABLE IF NOT EXISTS sticky_yarn (
      id         serial PRIMARY KEY,
      from_id    integer NOT NULL,
      to_id      integer NOT NULL,
      color      text NOT NULL DEFAULT 'red',
      board_no   integer NOT NULL DEFAULT 1,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    // The Projects tracker: teams and statuses are managed lists, projects
    // carry the accountability date (phase_due), project_log is the
    // APPEND-ONLY diary (no active column on purpose — nothing in it is
    // ever edited or deleted), milestones feed the projects calendar.
    await sql`CREATE TABLE IF NOT EXISTS project_teams (
      id         serial PRIMARY KEY,
      name       text NOT NULL,
      sort       integer NOT NULL DEFAULT 0,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text NOT NULL DEFAULT ''
    )`;
    await sql`CREATE TABLE IF NOT EXISTS project_statuses (
      id         serial PRIMARY KEY,
      label      text NOT NULL,
      color      text NOT NULL DEFAULT 'violet',
      sort       integer NOT NULL DEFAULT 0,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS projects (
      id           serial PRIMARY KEY,
      title        text NOT NULL,
      description  text NOT NULL DEFAULT '',
      people       text NOT NULL DEFAULT '',
      team_id      integer NOT NULL,
      status_id    integer NOT NULL,
      links        jsonb NOT NULL DEFAULT '[]',
      phase_due    date NOT NULL,
      phase_set_at timestamptz NOT NULL DEFAULT now(),
      phase_set_by text NOT NULL DEFAULT '',
      active       boolean NOT NULL DEFAULT true,
      created_at   timestamptz NOT NULL DEFAULT now(),
      created_by   text NOT NULL DEFAULT '',
      updated_at   timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS project_log (
      id             serial PRIMARY KEY,
      project_id     integer NOT NULL,
      kind           text NOT NULL,
      note           text NOT NULL DEFAULT '',
      from_status_id integer,
      to_status_id   integer,
      phase_due      date,
      actor          text NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS project_milestones (
      id         serial PRIMARY KEY,
      project_id integer NOT NULL,
      date       date NOT NULL,
      title      text NOT NULL,
      detail     text NOT NULL DEFAULT '',
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text NOT NULL DEFAULT ''
    )`;
    // Teams carry a leader (a team_members id) for the catalog hierarchy.
    await sql`ALTER TABLE project_teams
      ADD COLUMN IF NOT EXISTS leader_id integer`;
    // The team member registry: real people, linked to their REC Room
    // trigram, taggable on projects. Phase 2 (self-set access codes) will
    // add hashed-credential columns here — never plaintext.
    await sql`CREATE TABLE IF NOT EXISTS team_members (
      id         serial PRIMARY KEY,
      name       text NOT NULL,
      trigram    text NOT NULL DEFAULT '',
      team_id    integer,
      title      text NOT NULL DEFAULT '',
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text NOT NULL DEFAULT ''
    )`;
    // phase 2: self-set member access codes — scrypt hash + salt only,
    // never plaintext. claimed_at doubles as the "is claimed" flag source.
    // v2: people-leader declaration + reporting line (manager_id → the
    // member they report to), so staff can sit below their leader.
    await sql`ALTER TABLE team_members
      ADD COLUMN IF NOT EXISTS code_hash text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS code_salt text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS is_leader boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS manager_id integer`;
    // v3: the manager tier. A manager's member sign-in carries every scope
    // (auth.js), and managers are the only ones who run the registry —
    // signing the team up, resetting codes, granting manager. Seeded ONCE
    // from Travis's roster (2 Sep 2026), same marker pattern as the staff
    // flag, so demoting someone later is never undone by a Setup re-run.
    await sql`ALTER TABLE team_members
      ADD COLUMN IF NOT EXISTS is_manager boolean NOT NULL DEFAULT false`;
    const MANAGERS = [
      ['LND', 'Nicholas Gregory', 'Global Head of Sales Enablement and Effectiveness', 'nicholas.gregory@qlik.com'],
      ['DKQ', 'Mike Fawcett', 'Director, Global Sales Enablement', 'mike.fawcett@qlik.com'],
      ['SYK', 'Steve Smart', 'Director, Sales Coaching', 'steve.smart@qlik.com'],
      ['RJF', 'Eric Payne', 'Global Sales Enablement Lead, Field Onboarding & Sales Tools', 'eric.payne@qlik.com'],
      ['KYI', 'Rafael Attux', 'Manager, Sales Enablement Platform & AI Innovation', 'rafael.attux@qlik.com'],
      ['QRC', 'Barb Vogt', 'Sales Enablement Specialist Team Leader – Sales', 'barb.vogt@qlik.com'],
      ['TVO', 'Travis Slusser', 'Senior Learning Strategist, Global Sales Enablement', 'travis.slusser@qlik.com'],
    ];
    const mgrSeeded = await sql`SELECT 1 FROM app_state WHERE key = 'managers_seeded' LIMIT 1`;
    if (!mgrSeeded.length) {
      for (const [tri, name, mTitle, mEmail] of MANAGERS) {
        const existing = await sql`SELECT id, title, email FROM team_members WHERE trigram = ${tri} LIMIT 1`;
        if (existing.length) {
          // promote in place; fill title/email only where Travis left them blank
          await sql`UPDATE team_members SET is_manager = true, active = true,
            title = CASE WHEN title = '' THEN ${mTitle} ELSE title END,
            email = CASE WHEN email = '' THEN ${mEmail} ELSE email END
            WHERE id = ${existing[0].id}`;
        } else {
          await sql`INSERT INTO team_members (name, trigram, title, email, is_manager, created_by)
            VALUES (${name}, ${tri}, ${mTitle}, ${mEmail}, true, 'setup')`;
        }
      }
      await sql`INSERT INTO app_state (key, value) VALUES ('managers_seeded', '1')
        ON CONFLICT (key) DO NOTHING`;
      done.push(`seeded ${MANAGERS.length} managers`);
    }
    await sql`CREATE TABLE IF NOT EXISTS project_members (
      id         serial PRIMARY KEY,
      project_id integer NOT NULL,
      member_id  integer NOT NULL,
      active     boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text NOT NULL DEFAULT ''
    )`;
    // Yarn anchors: WHERE on each item the string is pinned, as fractions
    // of the item's box (0..1). Null = legacy yarn; the client clips those
    // to the item's edge instead of the old center-through-the-paper look.
    await sql`ALTER TABLE sticky_yarn
      ADD COLUMN IF NOT EXISTS from_ax real,
      ADD COLUMN IF NOT EXISTS from_ay real,
      ADD COLUMN IF NOT EXISTS to_ax real,
      ADD COLUMN IF NOT EXISTS to_ay real`;
    // Keys & Services: runtime-editable secrets (lib/secrets.js resolves
    // row → env var → ''). Seeds only the notification address.
    await sql`CREATE TABLE IF NOT EXISTS app_secrets (
      name       text PRIMARY KEY,
      value      text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text NOT NULL DEFAULT ''
    )`;
    await sql`INSERT INTO app_secrets (name, value, updated_by)
      VALUES ('NOTIFY_EMAIL', 'travis.slusser@qlik.com', 'setup')
      ON CONFLICT (name) DO NOTHING`;
    done.push('tables');

    // Projects: seed the status ladder (Travis's five, in pipeline order)
    // and one team so a project can be created on day one — both editable
    // in the Board's managers, and only into empty tables.
    const psCount = await sql`SELECT count(*)::int AS n FROM project_statuses`;
    if (psCount[0].n === 0) {
      const ladder = [
        ['Planning', 'violet', 0], ['In-Production', 'teal', 1],
        ['Testing', 'amber', 2], ['Beta', 'rose', 3], ['Alpha', 'blue', 4],
      ];
      for (const [label, color, sort] of ladder) {
        await sql`INSERT INTO project_statuses (label, color, sort) VALUES (${label}, ${color}, ${sort})`;
      }
      done.push('seeded 5 project statuses');
    }
    const ptCount = await sql`SELECT count(*)::int AS n FROM project_teams`;
    if (ptCount[0].n === 0) {
      await sql`INSERT INTO project_teams (name, sort) VALUES ('Sales Enablement', 0)`;
      done.push('seeded 1 project team');
    }

    const catCount = await sql`SELECT count(*)::int AS n FROM event_categories`;
    if (catCount[0].n === 0) {
      for (const [key, label, color] of SEED_CATEGORIES) {
        await sql`INSERT INTO event_categories (key, label, color) VALUES (${key}, ${label}, ${color})`;
      }
      done.push('seeded categories');
    }

    const evCount = await sql`SELECT count(*)::int AS n FROM events`;
    if (evCount[0].n === 0) {
      for (const e of SEED_EVENTS) {
        await sql`INSERT INTO events (date, category, title, detail, full_copy, link, pin)
          VALUES (${e.date}, ${e.category}, ${e.title}, ${e.detail},
                  ${e.full || ''}, ${e.link || ''}, ${!!e.pin})`;
      }
      done.push(`seeded ${SEED_EVENTS.length} events`);
    }

    const bnCount = await sql`SELECT count(*)::int AS n FROM banners`;
    if (bnCount[0].n === 0) {
      for (const b of SEED_BANNERS) {
        await sql`INSERT INTO banners (board, kicker, title, body, date_text, ctas, sort)
          VALUES (${b.board}, ${b.kicker}, ${b.title}, ${b.body},
                  ${b.date_text || ''}, ${JSON.stringify(b.ctas)}::jsonb, ${b.sort})`;
      }
      done.push(`seeded ${SEED_BANNERS.length} banners`);
    }

    // stamp the schema version — the update banner reads this via whoami
    await sql`INSERT INTO app_state (key, value) VALUES ('schema_version', ${String(SCHEMA_VERSION)})
      ON CONFLICT (key) DO UPDATE SET value = ${String(SCHEMA_VERSION)}, updated_at = now()`;
    done.push(`schema version ${SCHEMA_VERSION}`);

    res.status(200).json({ ok: true, done });
  } catch (err) {
    res.status(500).json({ error: 'Migration failed', detail: String(err), done });
  }
}
