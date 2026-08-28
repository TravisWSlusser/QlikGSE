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
  const table = (params && params[0]) || 'questions';
  const root = h('div', { class: 'view' });

  root.appendChild(h('div', { class: 'tabs' }, TABS.map(([key, label]) =>
    h('a', { class: 'tab' + (key === table ? ' on' : ''), href: '#questions/' + key }, label))));

  const body = h('div', null, spinner());
  root.appendChild(body);
  load(body, table, rerender);
  return root;
}

async function load(body, table, rerender) {
  let d;
  try { d = await api.listQuestions(table); }
  catch (err) { clear(body).appendChild(errorState(err, () => load(body, table, rerender))); return; }
  clear(body);

  const tabMeta = TABS.find(t => t[0] === table);
  const rows = d.rows || [];
  const activeN = rows.filter(r => r.active).length;

  const filterBox = h('input', {
    type: 'search', placeholder: 'Filter…', class: 'filter', onInput: () => draw(),
  });
  const listWrap = h('div');
  body.appendChild(h('div', { class: 'card' },
    sectionTitle(`${tabMeta[1]} — ${activeN} active of ${rows.length}`,
      filterBox,
      h('button', { class: 'btn accent', onClick: () => edit(null, table, rerender) }, '+ New')),
    h('p', { class: 'sub' }, tabMeta[2]),
    listWrap));

  function matches(r, q) {
    return JSON.stringify(r).toUpperCase().includes(q);
  }

  function draw() {
    const q = filterBox.value.trim().toUpperCase();
    const shown = rows.filter(r => !q || matches(r, q));
    clear(listWrap);
    if (!shown.length) { listWrap.appendChild(emptyState('Nothing matches.')); return; }
    listWrap.appendChild(h('div', { class: 'q-list' }, shown.map(r => qRow(r, table, rerender))));
  }
  draw();
}

function qRow(r, table, rerender) {
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
  return h('div', { class: 'q-row' + (r.active ? '' : ' retired') },
    h('div', { class: 'q-main' },
      h('div', { class: 'q-title' }, `#${r.id} — ${title}`, ...tags, r.active ? null : chip('retired', 'muted')),
      h('div', { class: 'q-sub' }, sub)),
    h('button', { class: 'btn sm', onClick: () => edit(r, table, rerender) }, 'Edit'),
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
