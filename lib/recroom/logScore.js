import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const TERRITORIES = ['NAM', 'LATAM', 'EMEA', 'APAC'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // ── Key gate ──
  // Two keys, either accepted. Desktop plays from the embedded widget with
  // MT_SESSION_REF; mobile launches out of the app with MT_SESSION_REF_MOBILE.
  // Independent so one can be rotated or revoked without killing the other —
  // the mobile key travels further (it lands in a phone's address bar and
  // history), so it is the one more likely to need replacing.
  //
  // Each var may hold a comma-separated LIST, which is what makes rotation
  // safe. There is no way to change the Vercel key and the Mindtickle widget
  // at the same instant — the widget URL is hand-edited in Page Builder, since
  // homepage custom-HTML widgets are not in Mindtickle's API. So rotate with
  // an overlap: append the new key to the list, redeploy, update the widget,
  // then remove the old one. Nobody sees a 401 in between.
  // ═══════════════════════════════════════════════════════════════════════
  // ⚠  TEMPORARY: KEY GATE OFF FOR THE DEMO  —  grep OPEN_SCORING to find this
  //
  // Turned off 2026-08-25 at Travis's request so the demo could score while
  // the widget/server key disagreement was still unresolved. While this is
  // true ANYONE who knows the URL can POST a score to the leaderboard.
  //
  // TO TURN IT BACK ON: set OPEN_SCORING to false. That is the whole change.
  //
  // It also fails closed on its own after OPEN_UNTIL, so forgetting is not the
  // same as leaving it open forever. If the demo runs long, move the date —
  // do not remove the expiry.
  //
  // 2026-08-26: expiry moved 27th -> 29th. The original date would have shut
  // scoring off at 00:00 UTC — 8pm ET — on the evening the game was being
  // announced to the whole enablement org, while the key mismatch was still
  // live. The 29th is a safety margin ONLY: the fix is the reissued key below,
  // and this should go to false the moment the widget URLs are confirmed, not
  // be left to expire.
  //
  // Deliberately NOT disabled: the plausibility ceiling and the per-trigram
  // cooldown below. Those are what stop this becoming a scoreboard anyone can
  // flood, and they cost a real player nothing.
  // ═══════════════════════════════════════════════════════════════════════
  const OPEN_SCORING = true;
  const OPEN_UNTIL   = Date.parse('2026-08-29T00:00:00Z');
  const gateOff = OPEN_SCORING && Date.now() < OPEN_UNTIL;

  const KEYS = [process.env.MT_SESSION_REF, process.env.MT_SESSION_REF_MOBILE]
    .filter(k => typeof k === 'string' && k.length > 0)
    .flatMap(k => k.split(',').map(s => s.trim()))
    .filter(Boolean);

  // The widget URL is hand-typed into Mindtickle Page Builder, and the trip
  // from there to here goes through a query string. Two documented ways a
  // correct key arrives wrong, both of which produced the 401s that led to
  // OPEN_SCORING existing at all:
  //
  //   '+'  URLSearchParams decodes a literal '+' in a query value as a SPACE,
  //        so a key containing '+' reaches the server with spaces in it and
  //        can never match. This is silent and looks exactly like a typo.
  //   ' '  a stray leading/trailing space survives a copy-paste.
  //
  // So compare the submitted key against a small set of deterministic
  // rewrites of ITSELF. This does not weaken the gate: every candidate is
  // derived from what the caller already sent, so it cannot help anyone guess
  // a key they do not have — it only stops transport from corrupting one they
  // do. (A '#' in a key truncates the URL before it is ever sent and cannot be
  // repaired here, which is why the issued key is alphanumeric only.)
  const submitted = (body.key == null ? '' : String(body.key));
  const candidates = new Set([
    submitted,
    submitted.trim(),
    submitted.replace(/ /g, '+'),
    submitted.trim().replace(/ /g, '+')
  ]);
  const keyOk = KEYS.length > 0 && KEYS.some(k => candidates.has(k));

  if (!gateOff && !keyOk) {
    // A bare "Unauthorized" cannot tell you WHICH side is wrong, and on launch
    // morning that difference is everything: no keys configured means the
    // Vercel env var is missing, no key received means the widget URL lost its
    // ?k=, and a key received but rejected means the two simply disagree.
    //
    // None of this is a key oracle. It reports whether the SERVER has any keys
    // at all, and echoes back the length of what the caller itself just sent.
    // It never confirms a guess — every wrong key still returns 401 and reveals
    // nothing about the right one.
    return res.status(401).json({
      error: 'Unauthorized',
      diag: {
        serverHasKeys: KEYS.length > 0,
        keyReceived: typeof body.key === 'string' && body.key.length > 0,
        receivedLength: (body.key || '').toString().length
      }
    });
  }

  // ── Validate inputs ──
  const trigram = (body.trigram || '').toString().trim().toUpperCase();
  const territory = (body.territory || '').toString().trim().toUpperCase();
  const country = (body.country_code || '').toString().trim().toLowerCase();
  const score = Number(body.score);
  const attempted = Number(body.attempted);
  const correct = Number(body.correct);

  // Per-category counters (three learning streams). Optional for back-compat:
  // the tester and older game builds send none, so each defaults to 0.
  // Re-clamped here too (correct <= attempted, both >= 0) — never trust the client.
  const toCount = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const qa = toCount(body.q_attempted), qc = Math.min(qa, toCount(body.q_correct));
  const ca = toCount(body.c_attempted), cc = Math.min(ca, toCount(body.c_correct));
  const ta = toCount(body.t_attempted), tc = Math.min(ta, toCount(body.t_correct));
  const durationSec = toCount(body.durationSec);   // session length; 0 if not sent

  if (!/^[A-Z]{2,4}$/.test(trigram)) return res.status(400).json({ error: 'Bad trigram' });
  if (!TERRITORIES.includes(territory)) return res.status(400).json({ error: 'Bad territory' });
  if (!/^[a-z]{2}$/.test(country)) return res.status(400).json({ error: 'Bad country_code' });
  for (const [n, v] of [['score', score], ['attempted', attempted], ['correct', correct]]) {
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: `Bad ${n}` });
  }
  if (correct > attempted) return res.status(400).json({ error: 'correct exceeds attempted' });

  // ── Plausibility, tied to time played ──
  //
  // A flat score ceiling punishes the player who genuinely survives fifteen
  // minutes, which is exactly the run you least want to reject. So the ceiling
  // grows with the clock: a long game earns a big allowance, and "half a
  // million points in four seconds" does not.
  //
  // BASE covers short-run variance and any build that predates durationSec
  // (those send 0, so they get BASE alone). RATE is deliberately far above
  // observed play — real runs have been landing around 1,000-2,000 — so this
  // only ever catches something obviously fabricated.
  const SCORE_BASE = 5000;   // allowance before the clock counts for anything
  const SCORE_RATE = 60;     // additional points allowed per second played
  const maxPlausible = SCORE_BASE + (SCORE_RATE * durationSec);
  if (score > maxPlausible) {
    return res.status(400).json({
      error: 'Score not plausible for the time played',
      score, durationSec, max: maxPlausible
    });
  }

  try {
    // ── Maintenance ──
    // Closing the room stops the pages letting anyone in, but a session already
    // open could still post a straggler mid-migration — which is exactly the
    // write you do not want landing while a wipe or a schema change is running.
    // So the write path checks too.
    //
    // Fails OPEN like the endpoint does: if this lookup errors, scoring
    // continues. The switch must never be able to reject real scores by
    // breaking. 503 (not 4xx) so the client knows to say "try again shortly"
    // rather than "your run was invalid".
    try {
      const st = await sql`SELECT value FROM app_state WHERE key = 'maintenance' LIMIT 1`;
      if (st.length && (st[0].value || '').trim().toLowerCase() === 'on') {
        return res.status(503).json({
          error: 'Maintenance',
          maintenance: true,
          detail: 'The REC Room is closed for a short update. This run was not saved.'
        });
      }
    } catch (e) { /* no table, no database, no problem — stay open */ }

    // ── Cooldown ──
    // No human finishes two runs ten seconds apart: there is a start screen,
    // a board to clear and a game-over between them. This costs a real player
    // nothing and forces anything scripted to crawl, which combined with the
    // plausibility ceiling above makes flooding both slow and worthless.
    const COOLDOWN_SEC = 10;
    const recent = await sql`
      SELECT extract(epoch from (now() - last_seen)) AS since
      FROM players WHERE trigram = ${trigram} LIMIT 1
    `;
    if (recent.length && recent[0].since !== null && Number(recent[0].since) < COOLDOWN_SEC) {
      return res.status(429).json({
        error: 'Too soon since the last score for this trigram',
        retryAfterSec: Math.ceil(COOLDOWN_SEC - Number(recent[0].since))
      });
    }

    const rows = await sql`
      INSERT INTO players
        (trigram, country_code, territory, total_score, last_score, attempted, correct,
         q_attempted, q_correct, c_attempted, c_correct, t_attempted, t_correct,
         blitz_personal_high, blitz_longest_sec, games_played, first_seen, last_seen)
      VALUES
        (${trigram}, ${country}, ${territory}, ${score}, ${score}, ${attempted}, ${correct},
         ${qa}, ${qc}, ${ca}, ${cc}, ${ta}, ${tc},
         ${score}, ${durationSec}, 1, now(), now())
      ON CONFLICT (trigram) DO UPDATE SET
        total_score  = players.total_score + ${score},
        last_score   = ${score},
        attempted    = players.attempted + ${attempted},
        correct      = players.correct + ${correct},
        q_attempted  = players.q_attempted + ${qa},
        q_correct    = players.q_correct + ${qc},
        c_attempted  = players.c_attempted + ${ca},
        c_correct    = players.c_correct + ${cc},
        t_attempted  = players.t_attempted + ${ta},
        t_correct    = players.t_correct + ${tc},
        blitz_personal_high = GREATEST(players.blitz_personal_high, ${score}),
        blitz_longest_sec   = GREATEST(players.blitz_longest_sec, ${durationSec}),
        games_played = players.games_played + 1,
        last_seen    = now()
      RETURNING trigram, territory, country_code, total_score, blitz_personal_high, attempted, correct, games_played
    `;

    // Record a discrete event so the live map can fire a burst for this submission.
    // Non-fatal: a logging failure must not fail the score write.
    try {
      await sql`
        INSERT INTO score_events (trigram, territory, country_code, points, game)
        VALUES (${trigram}, ${territory}, ${country}, ${score}, 'blitz')
      `;
    } catch (e) { /* ignore event-log failure */ }

    // openScoring rides on the response so "did I remember to turn it back on?"
    // is answerable in one request instead of a code read.
    res.status(200).json({ ok: true, player: rows[0], openScoring: gateOff || undefined });
  } catch (err) {
    res.status(500).json({ error: 'Write failed', detail: String(err) });
  }
}
