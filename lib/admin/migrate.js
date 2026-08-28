import { sql, requireScope, cors } from './auth.js';

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
  const who = await requireScope(req, res, 'system');
  if (!who) return;

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
    done.push('tables');

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

    res.status(200).json({ ok: true, done });
  } catch (err) {
    res.status(500).json({ error: 'Migration failed', detail: String(err), done });
  }
}
