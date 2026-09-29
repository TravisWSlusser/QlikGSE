/* questions.js — the three game banks. Edits reach the game on the next
   question draw (the game fetches per question, no cache).

   Three tables, three shapes — the tabs keep them separate rather than
   pretending to a common schema:
   - questions            Brain Freeze: prompt + 4 options + correct letter
   - methodology_questions Coins: category, prompt+question, options, correct,
                          explanation, read_seconds
   - glossary_terms       Brain Blast: term + definition */
import { h, clear, esc } from '../util.js';
import { api } from '../api.js';
import { toast, modal, confirmBox, field, textInput, textArea, select, spinner, errorState, sectionTitle, chip, emptyState } from '../ui.js';

const TABS = [
  ['questions', 'Brain Freeze', 'Knowledge questions — the frozen-DORC quiz.'],
  ['methodology_questions', 'Methodology', 'Coin questions for Methodology Madness, by stream.'],
  ['glossary_terms', 'Brain Blast', 'Glossary terms — the 3-question BAM-BAM-BAM scene.'],
];
const CATS = [
  { value: 'term', label: 'Term' },
  { value: 'green_sheet', label: 'Green Sheet' },
  { value: 'blue_sheet', label: 'Blue Sheet' },
];
const LETTERS = ['a', 'b', 'c', 'd'];

export function render(params, rerender) {
  const table = TABS.some(t => t[0] === (params && params[0])) ? params[0] : 'questions';
  // '#questions/<table>/new' (a Home quick action) opens the editor on arrival.
  const wantNew = params && params[1] === 'new';
  if (wantNew) history.replaceState(null, '', '#questions/' + table);
  const root = h('div', { class: 'view' });

  root.appendChild(h('div', { class: 'tabs' }, TABS.map(([key, label]) =>
    h('a', { class: 'tab' + (key === table ? ' on' : ''), href: '#questions/' + key }, label))));

  const body = h('div', null, spinner());
  root.appendChild(body);
  load(body, table, rerender, wantNew);
  return root;
}

async function load(body, table, rerender, wantNew) {
  let d;
  try { d = await api.listQuestions(table); }
  catch (err) { clear(body).appendChild(errorState(err, () => load(body, table, rerender))); return; }
  /* Answer performance rides alongside the bank. Sub-wrapped: this is the
     editing page, and a stats endpoint that is unavailable (no analytics
     scope, pre-Setup) must never stop someone fixing a typo. */
  let stats = null;
  try { stats = await api.questionStats(); } catch { /* no stats, no problem */ }
  clear(body);

  const tabMeta = TABS.find(t => t[0] === table);
  const rows = d.rows || [];
  const activeN = rows.filter(r => r.active).length;

  /* Per-row answer performance, keyed by id, for THIS bank only.
     minAttempts is the server's own floor - under it a miss rate is noise,
     and a bar that swings to 100% on a single wrong answer would send an
     SME rewriting a question nobody has actually struggled with. */
  const minAtt = (stats && stats.minAttempts) || 5;
  const perf = {};
  for (const r of (stats && stats.rows) || []) {
    if (r.table === table) perf[r.id] = r;
  }
  const missOf = id => {
    const r = perf[id];
    if (!r || !(r.attempted > 0)) return null;
    const missed = Math.max(0, r.attempted - r.correct);
    const thin = r.attempted < minAtt;
    return {
      attempted: r.attempted, missed,
      pct: Math.round(100 * missed / r.attempted),
      thin,
      title: `${missed} of ${r.attempted} answers missed`
        + (thin ? ` — still noise below ${minAtt} answers` : ''),
    };
  };
  body.appendChild(missedCard(table, tabMeta, rows, perf, minAtt, missOf));

  const filterBox = h('input', {
    type: 'search', placeholder: 'Filter…', class: 'filter', onInput: () => draw(),
  });
  const listWrap = h('div');
  body.appendChild(h('div', { class: 'card' },
    sectionTitle(`${tabMeta[1]} — ${activeN} active of ${rows.length}`,
      filterBox,
      h('button', { class: 'btn accent', onClick: () => edit(null, table, rerender) }, '+ New')),
    h('p', { class: 'explain' }, tabMeta[2]),
    listWrap));

  function matches(r, q) {
    return JSON.stringify(r).toUpperCase().includes(q);
  }

  function draw() {
    const q = filterBox.value.trim().toUpperCase();
    const shown = rows.filter(r => !q || matches(r, q));
    clear(listWrap);
    if (!shown.length) { listWrap.appendChild(emptyState('Nothing matches.')); return; }
    listWrap.appendChild(h('div', { class: 'q-list' },
      shown.map(r => qRow(r, table, rerender, d.retire_hours, missOf(r.id)))));
  }
  draw();

  // Repaint the countdowns so a ring does not sit frozen on an open tab.
  // draw() re-reads filterBox rather than rebuilding it, so the filter (and
  // focus) survive the tick. Dies with the view, like the other CAPCOM timers.
  if (rows.some(r => !r.active && r.retired_at) && d.retire_hours) {
    const tick = setInterval(() => {
      if (!listWrap.isConnected) { clearInterval(tick); return; }
      draw();
    }, RETIRE_TICK_MS);
  }

  if (wantNew) edit(null, table, rerender);
}


/* ── Most missed, for this bank ──
 *
 * This lived in the Stellar-Seller strip on Home, three scrolls away from
 * the questions it was talking about. Here it sits on top of the bank it
 * describes, and every row below carries its own miss bar, so "which ones
 * need work" and "here is the one to fix" are the same screen.
 *
 * The floor matters: under minAttempts a miss rate is noise. Those rows
 * still show their bar (muted) but never make this list — an SME should
 * not rewrite a question because one person fat-fingered it.
 */
function missedCard(table, tabMeta, rows, perf, minAtt, missOf) {
  const card = h('div', { class: 'card' });
  const titleOf = r => table === 'questions' ? r.prompt
    : table === 'methodology_questions' ? (r.question || r.prompt)
    : r.term;

  const scored = rows
    .filter(r => r.active)
    .map(r => ({ r, m: missOf(r.id) }))
    .filter(x => x.m && !x.m.thin && x.m.pct > 0)
    .sort((a, b) => b.m.pct - a.m.pct || b.m.attempted - a.m.attempted)
    .slice(0, 5);

  const answered = rows.filter(r => perf[r.id]).length;
  card.appendChild(sectionTitle('Where people need help',
    h('span', { class: 'sec-sub' }, answered
      ? `${answered} of ${rows.length} have answers`
      : 'no answers recorded yet')));

  if (!answered) {
    card.appendChild(h('p', { class: 'explain' },
      table === 'methodology_questions'
        ? 'This bank has never recorded answer stats — the counter collided with the answer-key column, so every write failed silently. Fixed in this update; counting starts from the next Coin round.'
        : `Fills in once questions have been answered. A miss rate only counts as a signal above ${minAtt} answers.`));
    return card;
  }

  if (!scored.length) {
    card.appendChild(h('p', { class: 'explain' },
      `Nothing is being missed often enough to flag. A question needs ${minAtt}+ answers before its miss rate means anything.`));
    return card;
  }

  // same severity scale as the per-row bars below, so the two readings of
  // the same number never disagree on screen
  const band = pct => pct >= 60 ? ' hot' : pct >= 30 ? ' warm' : '';
  card.appendChild(h('div', { class: 'miss-list' }, scored.map(({ r, m }) =>
    h('div', { class: 'miss-row' + band(m.pct), title: titleOf(r) },
      h('div', { class: 'miss-main' },
        h('span', { class: 'miss-label' }, `#${r.id} — ${titleOf(r)}`),
        h('span', { class: 'miss-meta' }, `${m.missed} of ${m.attempted} missed`)),
      h('div', { class: 'miss-track' }, h('div', { class: 'miss-fill', style: { width: m.pct + '%' } })),
      h('span', { class: 'miss-pct' }, m.pct + '%')))));
  card.appendChild(h('p', { class: 'explain' },
    `Ranked by miss rate, ${minAtt}+ answers only. Every row in the bank below carries the same bar.`));
  return card;
}

/* ---- retirement countdown ----------------------------------------------
   Retiring is a soft delete with a grace period: listQuestions sweeps
   anything past the window on the next load. `hours` comes from that same
   payload (retire_hours) rather than a second copy of the number here.
   Past zero the row is still listed — it goes on the next load, and the
   label says so rather than pretending it is already gone. */
const RETIRE_TICK_MS = 60000;

function retireLeft(retiredAt, hours) {
  const span = hours * 3600e3;
  const gone = Date.now() - new Date(retiredAt).getTime();
  const pct = Math.max(0, Math.min(100, (gone / span) * 100));
  const leftMs = Math.max(0, span - gone);
  const hh = Math.floor(leftMs / 3600e3);
  const mm = Math.floor((leftMs % 3600e3) / 60000);
  const label = leftMs <= 0 ? 'goes on the next load'
              : hh >= 1 ? `${hh}h ${mm}m left`
              : `${mm}m left`;
  return { pct, label };
}

function qRow(r, table, rerender, retireHours, miss) {
  let title, sub, tags = [];
  if (table === 'questions') {
    title = r.prompt;
    sub = `✓ ${r['option_' + r.correct_option]}`;
  } else if (table === 'methodology_questions') {
    title = r.question || r.prompt;
    sub = `✓ ${r['option_' + r.correct]}`;
    tags.push(chip((CATS.find(c => c.value === r.category) || {}).label || r.category, 'muted'));
    tags.push(chip(r.read_seconds + 's read', 'muted'));
  } else {
    title = r.term;
    sub = r.definition;
  }
  const countdown = (!r.active && r.retired_at && retireHours)
    ? retireLeft(r.retired_at, retireHours) : null;

  const editBtn = h('button', { class: 'btn sm', onClick: () => edit(r, table, rerender) }, 'Edit');
  // The ring sits ON the Edit button because Edit is the way back: opening a
  // retired row is where the Restore button lives.
  const editCell = countdown
    ? h('span', { class: 'edit-wrap', style: `--pct:${countdown.pct.toFixed(1)}` },
        editBtn,
        h('span', { class: 'retire-pie',
          title: `Deleted for good in ${countdown.label}. Open it and hit Restore to keep it.` }))
    : editBtn;

  /* The miss bar. Colour carries the same information as the number, so
     it is never colour ALONE: the percentage sits beside it and the title
     spells the counts out. A thin sample is drawn muted and labelled
     rather than hidden - "3 answers" is useful, it just is not a verdict. */
  const missCell = miss
    ? h('div', {
      class: 'q-miss' + (miss.thin ? ' thin' : miss.pct >= 60 ? ' hot' : miss.pct >= 30 ? ' warm' : ''),
      title: miss.title,
    },
      h('div', { class: 'q-miss-track' },
        h('div', { class: 'q-miss-fill', style: { width: Math.max(2, miss.pct) + '%' } })),
      h('span', { class: 'q-miss-pct' }, miss.pct + '%'),
      h('span', { class: 'q-miss-n' }, `${miss.attempted} ans`))
    : null;

  return h('div', { class: 'q-row' + (r.active ? '' : ' retired') },
    h('div', { class: 'q-main' },
      h('div', { class: 'q-title' }, `#${r.id} — ${title}`, ...tags,
        r.active ? null : chip(countdown ? `retired · ${countdown.label}` : 'retired', 'muted')),
      h('div', { class: 'q-sub' }, sub)),
    missCell,
    editCell,
    r.active
      ? h('button', {
          class: 'btn sm danger', onClick: () =>
            confirmBox('Retire this one?', 'It leaves the game on the next draw. The row stays and can be restored. The server refuses if the bank would drop below what the game needs.',
              async () => {
                try { await api.deleteQuestion(table, r.id); toast('Retired'); rerender(); }
                catch (err) { toast(err.message, 'err'); }
              }, 'Retire it'),
        }, 'Retire')
      : null);
}

function edit(r, table, rerender) {
  const isNew = !r;
  const save = async (c, payload) => {
    try {
      await api.saveQuestion({ table, id: r ? r.id : null, active: r ? r.active : true, ...payload });
      c(); toast(isNew ? 'Created' : 'Saved'); rerender();
    } catch (err) { toast(err.message, 'err'); }
  };
  const restoreBtn = (r && !r.active)
    ? [{ label: 'Restore', onClick: async c => {
        try { await api.saveQuestion({ table, id: r.id, ...rowPayload(r, table), active: true }); c(); toast('Restored'); rerender(); }
        catch (err) { toast(err.message, 'err'); }
      } }]
    : [];

  if (table === 'questions') {
    r = r || { prompt: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'a', active: true };
    const f = {
      prompt: textArea({ value: r.prompt, rows: 2 }),
      a: textInput({ value: r.option_a }), b: textInput({ value: r.option_b }),
      c: textInput({ value: r.option_c }), d: textInput({ value: r.option_d }),
      correct: select(LETTERS.map(l => ({ value: l, label: l.toUpperCase(), selected: l === r.correct_option }))),
    };
    modal(isNew ? 'New Brain Freeze question' : 'Edit question',
      h('div', { class: 'form' },
        field('Prompt', f.prompt),
        field('Option A', f.a), field('Option B', f.b), field('Option C', f.c), field('Option D', f.d),
        field('Correct answer', f.correct)),
      [...restoreBtn, { label: 'Cancel', onClick: c => c() },
        { label: isNew ? 'Create' : 'Save', kind: 'accent', onClick: c => save(c, {
          prompt: f.prompt.value, option_a: f.a.value, option_b: f.b.value,
          option_c: f.c.value, option_d: f.d.value, correct_option: f.correct.value,
          active: r.active }) }]);

  } else if (table === 'methodology_questions') {
    r = r || { category: 'term', prompt: '', question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct: 'a', explanation: '', read_seconds: 8, active: true };
    const f = {
      category: select(CATS.map(c => ({ ...c, selected: c.value === r.category }))),
      prompt: textInput({ value: r.prompt }),
      question: textArea({ value: r.question, rows: 2 }),
      a: textInput({ value: r.option_a }), b: textInput({ value: r.option_b }),
      c: textInput({ value: r.option_c }), d: textInput({ value: r.option_d }),
      correct: select(LETTERS.map(l => ({ value: l, label: l.toUpperCase(), selected: l === r.correct }))),
      explanation: textArea({ value: r.explanation, rows: 2 }),
      read: h('input', { type: 'number', min: 3, max: 60, value: r.read_seconds }),
    };
    modal(isNew ? 'New Methodology question' : 'Edit question',
      h('div', { class: 'form' },
        field('Stream', f.category),
        field('Prompt', f.prompt, 'The short setup line.'),
        field('Question', f.question, 'The full question text.'),
        field('Option A', f.a), field('Option B', f.b), field('Option C', f.c), field('Option D', f.d),
        field('Correct answer', f.correct),
        field('Explanation', f.explanation, 'The teaching line shown after they answer.'),
        field('Reading seconds', f.read, '3–60. How long the timer gives them to read before answering. Long answers need more.')),
      [...restoreBtn, { label: 'Cancel', onClick: c => c() },
        { label: isNew ? 'Create' : 'Save', kind: 'accent', onClick: c => save(c, {
          category: f.category.value, prompt: f.prompt.value, question: f.question.value,
          option_a: f.a.value, option_b: f.b.value, option_c: f.c.value, option_d: f.d.value,
          correct: f.correct.value, explanation: f.explanation.value,
          read_seconds: Number(f.read.value), active: r.active }) }]);

  } else {
    r = r || { term: '', definition: '', active: true };
    const f = { term: textInput({ value: r.term }), definition: textArea({ value: r.definition, rows: 3 }) };
    modal(isNew ? 'New glossary term' : 'Edit term',
      h('div', { class: 'form' },
        field('Term', f.term, 'Must be unique — Brain Blast scores by the term text.'),
        field('Definition', f.definition)),
      [...restoreBtn, { label: 'Cancel', onClick: c => c() },
        { label: isNew ? 'Create' : 'Save', kind: 'accent', onClick: c => save(c, {
          term: f.term.value, definition: f.definition.value, active: r.active }) }]);
  }
}

/* Rebuild the full payload for a restore, since saveQuestion validates
   every field on update. */
function rowPayload(r, table) {
  if (table === 'questions') return {
    prompt: r.prompt, option_a: r.option_a, option_b: r.option_b,
    option_c: r.option_c, option_d: r.option_d, correct_option: r.correct_option };
  if (table === 'methodology_questions') return {
    category: r.category, prompt: r.prompt, question: r.question,
    option_a: r.option_a, option_b: r.option_b, option_c: r.option_c, option_d: r.option_d,
    correct: r.correct, explanation: r.explanation, read_seconds: r.read_seconds };
  return { term: r.term, definition: r.definition };
}
