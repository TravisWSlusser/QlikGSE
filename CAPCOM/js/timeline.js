/* timeline.js — a person's wall, and the composer that feeds it.
 *
 * Shared by the Profile page (one person's wall) and Home (the rotating
 * widget). Kept out of both so the rendering of a post is written once:
 * a post looks the same wherever it is quoted, which is most of what
 * makes a feed feel like a feed.
 *
 * Three kinds, deliberately the corkboard's three — text, link, sticker.
 * People already know how those behave there.
 */
import { h, clear, fmt } from './util.js';
import { api } from './api.js';
import { toast, modal, field, textInput, textArea, confirmBox, spinner, emptyState } from './ui.js';
import { avatar } from './avatar.js';
import { giphyGrid } from './giphy.js';

export const REACT_SET = ['👍', '🎉', '🔥', '😂', '💚', '👏'];

/* Who is looking. Set once by the shell so the feed can tell "nobody has
   posted" from "only YOU have posted" - two very different states that
   look identical without it, because the self rule hides every button. */
let ME_ID = 0;
export function setViewer(id) { ME_ID = id || 0; }

/* postBody(p) — just the content, no chrome. The widget wraps it in a
   rotating card, the profile wraps it in a row with a date and controls. */
export function postBody(p) {
  if (p.kind === 'sticker') {
    return h('img', { class: 'tl-sticker', src: p.sticker_url, alt: '', loading: 'lazy' });
  }
  if (p.kind === 'link') {
    return h('a', {
      class: 'tl-link', href: p.link_url, target: '_blank', rel: 'noopener',
      // a link someone posted is not ours; say where it goes before it is clicked
      title: p.link_url,
    },
      h('span', { class: 'tl-link-t' }, p.message || p.link_url),
      h('span', { class: 'tl-link-u' }, hostOf(p.link_url)));
  }
  return h('p', { class: 'tl-text' }, p.message);
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/* The composer. onDone fires after a successful post. */
export function composer(onDone) {
  const open = kind => {
    if (kind === 'sticker') return stickerPost(onDone);
    if (kind === 'link') return linkPost(onDone);
    return textPost(onDone);
  };
  return h('div', { class: 'tl-compose' },
    h('button', { class: 'btn accent', onClick: () => open('text') }, 'Post'),
    h('button', { class: 'btn', onClick: () => open('link') }, '+ Link'),
    h('button', { class: 'btn', onClick: () => open('sticker') }, '+ Sticker'));
}

const send = async (body, c, onDone) => {
  try {
    await api.timeline({ op: 'post', ...body });
    if (c) c();
    toast('Posted');
    if (onDone) onDone();
  } catch (err) { toast(err.message, 'err'); }
};

function textPost(onDone) {
  const msg = textArea({ maxLength: 500, rows: 4, placeholder: 'What are you working on, thinking about, stuck on…' });
  modal('Post to your timeline',
    h('div', { class: 'form' }, field('Say something', msg,
      'Goes on your profile and into the rotation on Home. You can take it down any time.')),
    [{ label: 'Cancel', onClick: c => c() },
      { label: 'Post it', kind: 'accent', onClick: c => {
        if (!msg.value.trim()) { toast('Say something first', 'err'); return; }
        send({ kind: 'text', message: msg.value }, c, onDone);
      } }]);
}

function linkPost(onDone) {
  const title = textInput({ maxLength: 200, placeholder: 'What is it?' });
  const url = textInput({ maxLength: 500, placeholder: 'https://…' });
  modal('Post a link',
    h('div', { class: 'form' },
      field('Title', title, 'What the link says on your timeline.'),
      field('URL', url, 'http:// or https:// — it opens in a new tab.')),
    [{ label: 'Cancel', onClick: c => c() },
      { label: 'Post it', kind: 'accent', onClick: c =>
        send({ kind: 'link', message: title.value, link_url: url.value.trim() }, c, onDone) }]);
}

function stickerPost(onDone) {
  let picked = '';
  modal('Post a sticker',
    giphyGrid(url => { picked = url; }),
    [{ label: 'Cancel', onClick: c => c() },
      { label: 'Post it', kind: 'accent', onClick: c => {
        if (!picked) { toast('Pick one first', 'err'); return; }
        send({ kind: 'sticker', sticker_url: picked }, c, onDone);
      } }]);
}


/* ── the thread ──
 *
 * Travis: "Allow folks to be able to comment/react to posts and status by
 * clicking on the post. Make it so they cant react to their own stuff but
 * can view the comments and reacts."
 *
 * So: one dialog, opened by clicking anything anyone said, anywhere. On
 * your OWN post the reaction buttons are absent and the comment box is
 * not — replying under your own thread with an update is how a wall
 * normally works, and only self-APPLAUSE is silly. The server refuses a
 * self-reaction regardless of what the client renders.
 *
 * openThread({ kind:'post'|'status', id }, onChange)
 */
export function openThread(target, onChange) {
  const body = h('div', { class: 'th-wrap' }, spinner());
  let close = null;
  modal('', body, [{ label: 'Close', kind: 'accent', onClick: c => { close = c; c(); } }]);
  load();

  async function load() {
    let d;
    try { d = await api.timeline({ op: 'thread', kind: target.kind, id: target.id }); }
    catch (err) { clear(body).appendChild(emptyState(err.message)); return; }
    clear(body);

    const p = d.target;
    const who = {
      id: p.member_id, name: p.name, title: p.title,
      trigram: p.trigram, avatar_url: p.avatar_url,
    };

    body.appendChild(h('div', { class: 'th-head' },
      avatar(who, { size: 'md' }),
      h('div', null,
        h('b', null, p.name),
        h('span', { class: 'sub' }, [p.title, fmt.when(p.created_at)].filter(Boolean).join(' · ')))));

    body.appendChild(h('div', { class: 'th-body' },
      p.source === 'status'
        ? h('p', { class: 'tl-text tl-quote' }, `“${p.message}”`)
        : postBody(p)));

    // ---- reactions ----
    const emojis = {};
    for (const r of d.reactions || []) if (r.emoji) (emojis[r.emoji] = emojis[r.emoji] || []).push(r.name);
    const stickers = (d.reactions || []).filter(r => r.sticker_url);

    const react = async extra => {
      try {
        await api.timeline({ op: 'react', kind: target.kind, id: target.id, ...extra });
        load(); if (onChange) onChange();
      } catch (err) { toast(err.message, 'err'); }
    };

    const rrow = h('div', { class: 'th-reacts' },
      ...Object.entries(emojis).map(([e, names]) =>
        h('span', { class: 'cat-react', title: names.join(', ') },
          `${e}${names.length > 1 ? ' ' + names.length : ''}`)),
      ...stickers.map(r => h('img', {
        class: 'cat-react-img', src: r.sticker_url, alt: '', title: r.name, loading: 'lazy' })));

    if (d.mine) {
      // yours: you see everything, you just cannot applaud it
      rrow.appendChild(h('span', { class: 'th-own' },
        (d.reactions || []).length ? 'Reactions to your post' : 'No reactions yet'));
    } else {
      REACT_SET.forEach(e => rrow.appendChild(
        h('button', { class: 'cat-react th-pick', title: 'React', onClick: () => react({ emoji: e }) }, e)));
      rrow.appendChild(h('button', { class: 'btn xs', onClick: () => {
        let picked = '';
        modal('React with a sticker', giphyGrid(u => { picked = u; }), [
          { label: 'Cancel', onClick: c => c() },
          { label: 'Stick it on', kind: 'accent', onClick: c => {
            if (!picked) { toast('Pick one first', 'err'); return; }
            c(); react({ sticker_url: picked });
          } }]);
      } }, 'Sticker'));
    }
    body.appendChild(rrow);

    // ---- comments ----
    const list = d.comments || [];
    body.appendChild(h('div', { class: 'th-c-lbl' },
      list.length ? `${list.length} comment${list.length === 1 ? '' : 's'}` : 'No comments yet'));
    if (list.length) {
      body.appendChild(h('div', { class: 'th-comments' }, list.map(c =>
        h('div', { class: 'th-comment' },
          avatar({ id: c.member_id, name: c.author_name, title: c.title, avatar_url: c.avatar_url },
            { size: 'xs' }),
          h('div', { class: 'th-c-body' },
            h('div', { class: 'th-c-head' },
              h('b', null, c.author_name),
              h('span', { class: 'sub' }, fmt.when(c.created_at))),
            h('p', null, c.body)),
          h('button', {
            class: 'tl-x th-c-x', title: 'Take this comment down',
            onClick: () => confirmBox('Take this comment down?', 'It stops being shown.',
              async () => {
                try { await api.timeline({ op: 'uncomment', id: c.id }); load(); }
                catch (err) { toast(err.message, 'err'); }
              }, 'Take it down'),
          }, '×')))));
    }

    const box = textInput({ placeholder: 'Write a comment…', maxLength: 1000 });
    const post = async () => {
      if (!box.value.trim()) return;
      try {
        await api.timeline({ op: 'comment', kind: target.kind, id: target.id, body: box.value });
        box.value = ''; load(); if (onChange) onChange();
      } catch (err) { toast(err.message, 'err'); }
    };
    box.addEventListener('keydown', e => { if (e.key === 'Enter') post(); });
    body.appendChild(h('div', { class: 'th-add' }, box,
      h('button', { class: 'btn accent', onClick: post }, 'Comment')));
  }
}

/* Anything that renders a post makes it clickable through this. */
export function clickable(el, target, onChange) {
  el.classList.add('tl-click');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const go = ev => {
    // let a real link, a button or a reaction do its own job first
    if (ev.target.closest('a, button, .cat-react, .tl-x')) return;
    openThread(target, onChange);
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); openThread(target, onChange); }
  });
  return el;
}

/* wall(posts, reactions, opts) — the list, for the Profile page.
   opts: { canPost, canRemove, pctx, reload } */
export function wall(posts, reactions, opts) {
  const byPost = {};
  for (const r of reactions || []) (byPost[r.post_id] = byPost[r.post_id] || []).push(r);

  const react = async (id, body) => {
    try { await api.timeline({ op: 'react', kind: 'post', id, ...body }); opts.reload(); }
    catch (err) { toast(err.message, 'err'); }
  };
  const stickerReact = id => {
    let picked = '';
    modal('React with a sticker', giphyGrid(u => { picked = u; }), [
      { label: 'Cancel', onClick: c => c() },
      { label: 'Stick it on', kind: 'accent', onClick: c => {
        if (!picked) { toast('Pick one first', 'err'); return; }
        c(); react(id, { sticker_url: picked });
      } }]);
  };

  return h('div', { class: 'tl-list' }, posts.map(p => {
    const mine = byPost[p.id] || [];
    const emojis = {};
    for (const r of mine) if (r.emoji) (emojis[r.emoji] = emojis[r.emoji] || []).push(r.name);
    const row = h('div', { class: 'tl-post' },
      h('div', { class: 'tl-when' }, fmt.when(p.created_at),
        opts.canRemove ? h('button', {
          class: 'tl-x', title: 'Take this down', onClick: () =>
            confirmBox('Take this post down?',
              'It stops being served everywhere. Reactions stay attached to it, so this can be undone in the database if it was a mistake.',
              async () => {
                try { await api.timeline({ op: 'remove', id: p.id }); toast('Taken down'); opts.reload(); }
                catch (err) { toast(err.message, 'err'); }
              }, 'Take it down'),
        }, '×') : null),
      postBody(p),
      h('div', { class: 'tl-reacts' },
        ...Object.entries(emojis).map(([e, names]) =>
          h('span', { class: 'cat-react', title: names.join(', ') },
            `${e}${names.length > 1 ? ' ' + names.length : ''}`)),
        ...mine.filter(r => r.sticker_url).map(r =>
          h('img', { class: 'cat-react-img', src: r.sticker_url, alt: '', title: r.name, loading: 'lazy' })),
        // the whole post is the door now; this stays as the fast path
        opts.canReact === false
          ? h('span', { class: 'cat-mine', title: 'Others can react to this' }, 'yours')
          : null,
        opts.canReact === false ? null : h('button', {
          class: 'cat-react cat-react-add', title: 'React',
          onClick: ev => opts.pctx(ev.clientX, ev.clientY, [
            ...REACT_SET.map(e => [e, () => react(p.id, { emoji: e }), false]),
            ['Sticker / meme…', () => stickerReact(p.id), false],
          ]),
        }, '+'),
        h('span', { class: 'tl-open' }, 'Open')));
    return clickable(row, { kind: 'post', id: p.id }, opts.reload);
  }));
}

/* The three places a person says something, and what to call each one
   when it comes round in the rotation. */
const SOURCE_TAG = {
  timeline: ['posted', 'src-post'],
  status:   ['status', 'src-status'],
  board:    ['on the board', 'src-board'],
};

/* feedCard(card) — Home's rotating widget: the latest thing each person
   said, wherever they said it, one at a time, fading through.
 *
 * Deliberately NOT a scrolling list: it shares a one-band slot with
 * Learning Insights, and a wall of posts there would push the corkboard
 * off the page.
 *
 * It NEVER removes itself. The first version did when the feed came back
 * empty, which is exactly the state a brand-new feature is in on the day
 * it ships - so the widget shipped, found nothing, deleted itself, and
 * read as a feature that had never been built. An empty state that hides
 * is indistinguishable from a bug.
 */
export async function feedCard(card, sectionTitle) {
  let posts = [];
  let failed = false;
  try {
    const d = await api.timeline({ op: 'feed' });
    posts = d.posts || [];
  } catch { failed = true; }

  clear(card);
  const people = new Set(posts.map(p => p.name)).size;
  card.appendChild(sectionTitle('Team timeline',
    h('span', { class: 'sec-sub' }, posts.length
      ? `${people} ${people === 1 ? 'person' : 'people'} · posts, statuses and the board`
      : '')));

  if (!posts.length) {
    card.appendChild(h('div', { class: 'tl-rot tl-rot-empty' },
      failed
        ? h('p', { class: 'sub' }, 'The feed is not answering right now.')
        : h('p', { class: 'sub' },
          'Nothing from the team yet. Post something on ',
          h('a', { class: 'lnk', href: '#profile' }, 'your timeline'),
          ' — a thought, a link, a sticker — or pin a note to the board, and it shows up here.')));
    return;
  }

  /* One item, and it is yours: the rotation has nothing to rotate and the
     self rule hides every reaction button on the page. Say that outright
     or it reads as a broken widget. */
  if (posts.length === 1 && posts[0].member_id === ME_ID) {
    card.appendChild(h('p', { class: 'sub tl-solo' },
      'This is the only thing anyone has posted so far — and it is yours, so there is nothing here to react to yet.'));
  }

  const slot = h('div', { class: 'tl-rot' });
  card.appendChild(slot);

  // dots, so it reads as a rotation rather than a card that changes on its own
  const dots = h('div', { class: 'tl-dots' },
    posts.map((_, n) => h('i', { class: 'tl-dot' + (n === 0 ? ' on' : '') })));
  if (posts.length > 1) card.appendChild(dots);

  let i = 0;
  const paint = () => {
    const p = posts[i];
    const who = { id: p.member_id, name: p.name, title: p.title, trigram: p.trigram, avatar_url: p.avatar_url };
    const [label, cls] = SOURCE_TAG[p.source] || SOURCE_TAG.timeline;
    const slide = h('div', { class: 'tl-rot-in' },
      // a board poster with no staff row has no id; avatar() falls back
      avatar(who, { size: 'sm', link: !!p.member_id }),
      h('div', { class: 'tl-rot-body' },
        h('div', { class: 'tl-rot-head' },
          h('b', null, p.name),
          h('span', { class: 'tl-src ' + cls }, label),
          h('span', { class: 'sub' }, fmt.when(p.created_at))),
        p.source === 'status'
          ? h('p', { class: 'tl-text tl-quote' }, `“${p.message}”`)
          : postBody(p)));
    /* A board note lives on the corkboard, not in a thread — there is
       nothing to open, so only wall posts and statuses become clickable. */
    if (p.source === 'timeline') clickable(slide, { kind: 'post', id: p.id }, null);
    else if (p.source === 'status') clickable(slide, { kind: 'status', id: p.member_id }, null);
    clear(slot).appendChild(slide);
    [...dots.children].forEach((d, n) => d.classList.toggle('on', n === i));
  };
  paint();

  if (posts.length > 1) {
    const tick = setInterval(() => {
      if (!slot.isConnected) { clearInterval(tick); return; }
      if (slot.matches(':hover')) return;   // pause while someone is reading it
      i = (i + 1) % posts.length;
      paint();
    }, 7000);
  }
}
