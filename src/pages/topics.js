import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster, participationPanel } from '../roster.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '보드';

// #/topics       → 주제 목록 (지난 주제도 모두)
// #/topics/3     → 주제 하나: 참가 현황 + 글 목록
export function render(view, ctx) {
  const [first] = ctx.params;
  if (!first) return renderTopics(view, ctx);
  if (!/^\d+$/.test(first)) {
    view.append(message('없는 주제예요.'));
    return;
  }
  return renderTopic(view, ctx, Number(first));
}

async function renderTopics(view, ctx) {
  const admin = isAdmin(ctx.user);
  view.append(el('h1', {}, '보드'), message('선생님이 정한 주제에 대해 글을 써요. 지난 주제의 글도 계속 볼 수 있어요.'));
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: topics, error }, { data: posts, error: postsError }, { data: roster }] = await Promise.all([
    supabase.from('topics').select('id, title, description, is_open, created_at').order('created_at', { ascending: false }),
    supabase.from('posts').select('topic_id, author_id').not('topic_id', 'is', null),
    fetchRoster(),
  ]);
  if (error || postsError) {
    box.replaceChildren(errorBox(error ?? postsError));
    return;
  }

  const studentIds = new Set((roster ?? []).map((s) => s.id));
  const stats = new Map();
  for (const post of posts) {
    const s = stats.get(post.topic_id) ?? { posts: 0, writers: new Set() };
    s.posts += 1;
    if (studentIds.has(post.author_id)) s.writers.add(post.author_id);
    stats.set(post.topic_id, s);
  }

  const item = (topic) => {
    const s = stats.get(topic.id) ?? { posts: 0, writers: new Set() };
    return el(
      'li',
      {},
      el(
        'a',
        { class: 'row-link', href: `#/topics/${topic.id}` },
        el(
          'div',
          { class: 'item-head' },
          el('span', { class: `badge ${topic.is_open ? 'later' : ''}` }, topic.is_open ? '진행 중' : '마감'),
          el('span', { class: 'row-title' }, topic.title),
        ),
        topic.description ? el('div', { class: 'row-meta preview' }, topic.description) : null,
        el('div', { class: 'row-meta' }, `글 ${s.posts}개 · 참여 ${s.writers.size} / ${studentIds.size} · ${formatDateTime(topic.created_at)}`),
      ),
    );
  };

  box.replaceChildren(
    topics.length === 0
      ? message(admin ? '아직 주제가 없어요. 아래에서 첫 주제를 만들어 보세요.' : '아직 주제가 없어요.')
      : el('ul', { class: 'list' }, topics.map(item)),
  );
  if (admin) view.append(topicForm(ctx));
}

// 관리자: 새 주제 만들기
function topicForm(ctx) {
  const titleInput = el('input', { id: 'topic-title', maxlength: '50', required: true, placeholder: '예: 내가 좋아하는 책 소개' });
  const descInput = el('textarea', { id: 'topic-desc', maxlength: '1000', placeholder: '무엇을 쓰면 되는지 설명 (선택)' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '주제 만들기');
  const form = el(
    'form',
    { class: 'card' },
    el('h2', {}, '새 주제'),
    el('label', { for: 'topic-title' }, '주제'),
    titleInput,
    el('label', { for: 'topic-desc' }, '설명'),
    descInput,
    status,
    el('div', { class: 'actions' }, submit),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = { title: titleInput.value.trim(), description: descInput.value.trim() || null };
    if (!values.title) {
      status.replaceChildren(message('주제를 써 주세요.', 'error'));
      return;
    }
    withBusy(submit, async () => {
      const { data, error } = await supabase.from('topics').insert(values).select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('만들 권한이 없어요.', 'error'));
        return;
      }
      location.hash = `#/topics/${data[0].id}`;
    });
  });
  return form;
}

async function renderTopic(view, ctx, id) {
  const admin = isAdmin(ctx.user);
  view.append(loading());

  const [{ data: topic, error }, { data: posts, error: postsError }, { data: roster }, names] = await Promise.all([
    supabase.from('topics').select('id, title, description, is_open, created_at').eq('id', id).maybeSingle(),
    supabase
      .from('posts')
      .select('id, title, content, created_at, author_id, author:profiles!author_id(username, nickname), post_files(count), comments(count), post_likes(count)')
      .eq('topic_id', id)
      .order('created_at', { ascending: false }),
    fetchRoster(),
    realNames(ctx.user),
  ]);
  if (error || postsError) {
    view.replaceChildren(errorBox(error ?? postsError));
    return;
  }
  if (!topic) {
    view.replaceChildren(message('없는 주제예요.'), el('a', { href: '#/topics' }, '보드 목록으로'));
    return;
  }

  // 참가 현황: 이 주제에 글을 쓴 학생
  const counts = new Map();
  for (const post of posts) counts.set(post.author_id, (counts.get(post.author_id) ?? 0) + 1);
  const done = new Map([...counts].map(([userId, n]) => [userId, `글 ${n}`]));

  const status = el('div');
  const toggle = admin ? el('button', { type: 'button', class: 'secondary' }, topic.is_open ? '마감하기' : '다시 열기') : null;
  toggle?.addEventListener('click', () => {
    if (topic.is_open && !confirm('이 주제를 마감할까요? 학생들은 더 이상 글을 쓸 수 없어요. (글은 그대로 남아요)')) return;
    withBusy(toggle, async () => {
      const { data, error: updateError } = await supabase.from('topics').update({ is_open: !topic.is_open }).eq('id', id).select('id');
      if (updateError || data.length === 0) {
        status.replaceChildren(updateError ? errorBox(updateError) : message('바꿀 권한이 없어요.', 'error'));
        return;
      }
      ctx.refresh();
    });
  });

  const canWrite = topic.is_open || admin;
  const postItem = (post) => {
    const files = post.post_files?.[0]?.count ?? 0;
    const comments = post.comments?.[0]?.count ?? 0;
    const likes = post.post_likes?.[0]?.count ?? 0;
    return el(
      'li',
      {},
      el(
        'a',
        { class: 'row-link', href: `#/board/${post.id}` },
        el('div', { class: 'row-title' }, post.title, comments ? el('span', { class: 'comment-count' }, ` [${comments}]`) : null, likes ? el('span', { class: 'like-count' }, ` ♥${likes}`) : null, files ? el('span', { class: 'clip' }, ` 📎${files}`) : null),
        el('div', { class: 'row-meta preview' }, post.content),
        el('div', { class: 'row-meta' }, `${withRealName(displayName(post.author), post.author_id, names)} · ${formatDateTime(post.created_at)}`),
      ),
    );
  };

  view.replaceChildren(
    el('a', { href: '#/topics' }, '← 보드 목록'),
    el(
      'section',
      { class: 'card topic-head' },
      el('div', { class: 'item-head' }, el('span', { class: `badge ${topic.is_open ? 'later' : ''}` }, topic.is_open ? '진행 중' : '마감'), el('h1', {}, topic.title)),
      topic.description ? el('p', { class: 'body-text' }, topic.description) : null,
      el(
        'div',
        { class: 'actions' },
        canWrite ? el('a', { class: 'button', href: `#/board/new?topic=${id}` }, '이 주제에 글쓰기') : el('span', { class: 'muted' }, '마감된 주제예요. 글을 볼 수만 있어요.'),
        el('span', { class: 'spacer' }),
        toggle,
      ),
      status,
    ),
    participationPanel(roster ?? [], done, names),
    el('h2', {}, `글 ${posts.length}개`),
    posts.length ? el('ul', { class: 'list' }, posts.map(postItem)) : message('아직 글이 없어요.'),
  );
}
