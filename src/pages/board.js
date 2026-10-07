import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { listFiles, removeAllFiles, removeFile, uploadFiles } from '../files.js';
import { attachmentsSection, filePicker } from '../attachments.js';
import { realNames, withRealName } from '../realnames.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '게시판';

const PAGE_SIZE = 20;
const TITLE_MAX = 50;
const CONTENT_MAX = 2000;
// 전화번호처럼 보이는 글자 (010-1234-5678, 01012345678, 031-123-4567 …)
const PHONE_PATTERN = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;

// #/board            → 목록
// #/board/new        → 글쓰기
// #/board/12         → 글 보기
// #/board/12/edit    → 글 고치기
export function render(view, ctx) {
  const [first, second] = ctx.params;
  if (!first) return renderList(view, ctx);
  if (first === 'new') return renderForm(view, ctx, null);
  if (!/^\d+$/.test(first)) {
    view.append(message('없는 글이에요.'));
    return;
  }
  if (second === 'edit') return renderForm(view, ctx, Number(first));
  return renderPost(view, ctx, Number(first));
}

async function renderList(view, ctx) {
  const page = Math.max(1, Number.parseInt(ctx.query.get('page'), 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  view.append(
    el('div', { class: 'toolbar' }, el('h1', {}, '게시판'), el('span', { class: 'spacer' }), el('a', { class: 'button', href: '#/board/new' }, '글쓰기')),
  );
  const body = el('div', {}, loading());
  view.append(body);

  // 게시판에는 보드(주제) 글을 빼고 보여 줌
  const fetchPage = (columns, onlyBoard = true) => {
    let query = supabase.from('posts').select(columns, { count: 'exact' });
    if (onlyBoard) query = query.is('topic_id', null);
    return query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };
  let { data, error, count } = await fetchPage('id, title, created_at, author_id, author:profiles!author_id(username, nickname), post_files(count), comments(count), post_likes(count)');
  // SQL(schema.sql)을 아직 다시 실행하지 않아 표·칸이 없으면, 📎·댓글 수 없이 기본 목록만
  if (['PGRST200', 'PGRST205', '42703'].includes(error?.code)) {
    ({ data, error, count } = await fetchPage('id, title, created_at, author_id, author:profiles!author_id(username, nickname)', false));
  }

  if (error) {
    body.replaceChildren(errorBox(error));
    return;
  }
  const names = await realNames(ctx.user);
  if (data.length === 0) {
    body.replaceChildren(message(page === 1 ? '아직 글이 없어요. 첫 글을 써 볼까요?' : '이 쪽에는 글이 없어요.'));
    return;
  }

  const list = el(
    'ul',
    { class: 'list' },
    data.map((post) => {
      const fileCount = post.post_files?.[0]?.count ?? 0;
      const commentCount = post.comments?.[0]?.count ?? 0;
      const likeCount = post.post_likes?.[0]?.count ?? 0;
      return el(
        'li',
        {},
        el(
          'a',
          { class: 'row-link', href: `#/board/${post.id}` },
          el(
            'div',
            { class: 'row-title' },
            post.title,
            commentCount ? el('span', { class: 'comment-count', title: `댓글 ${commentCount}개` }, ` [${commentCount}]`) : null,
            likeCount ? el('span', { class: 'like-count', title: `공감 ${likeCount}개` }, ` ♥${likeCount}`) : null,
            fileCount ? el('span', { class: 'clip', title: `첨부 ${fileCount}개` }, ` 📎${fileCount}`) : null,
          ),
          el('div', { class: 'row-meta' }, `${withRealName(displayName(post.author), post.author_id, names)} · ${formatDateTime(post.created_at)}`),
        ),
      );
    }),
  );

  const lastPage = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pager =
    lastPage > 1
      ? el(
          'div',
          { class: 'pager' },
          page > 1 ? el('a', { href: `#/board?page=${page - 1}` }, '◀ 이전') : null,
          el('span', { class: 'muted' }, `${page} / ${lastPage}`),
          page < lastPage ? el('a', { href: `#/board?page=${page + 1}` }, '다음 ▶') : null,
        )
      : null;

  body.replaceChildren(list, pager ?? '');
}

async function renderPost(view, ctx, id) {
  view.append(loading());

  const [{ data: post, error }, { data: files, error: filesError }, names, comments, likes] = await Promise.all([
    supabase
      .from('posts')
      .select('*, author:profiles!author_id(username, nickname)')
      .eq('id', id)
      .maybeSingle(),
    listFiles(id),
    realNames(ctx.user),
    fetchComments(id),
    fetchLikes(id),
  ]);

  if (error) {
    view.replaceChildren(errorBox(error));
    return;
  }
  if (!post) {
    view.replaceChildren(message('없는 글이에요. 지워졌을 수도 있어요.'), el('a', { href: '#/board' }, '목록으로'));
    return;
  }

  // 보드(주제) 글이면 그 주제로 돌아가기
  let topic = null;
  if (post.topic_id) {
    ({ data: topic } = await supabase.from('topics').select('id, title').eq('id', post.topic_id).maybeSingle());
  }
  const backHref = topic ? `#/topics/${topic.id}` : '#/board';
  const backText = topic ? '주제로 돌아가기' : '목록으로';

  const mine = post.author_id === ctx.user.id;
  const canDelete = mine || isAdmin(ctx.user);
  const edited = new Date(post.updated_at) - new Date(post.created_at) > 1000;
  const status = el('div');

  const deleteButton = el('button', { type: 'button', class: 'danger' }, '삭제');
  deleteButton.addEventListener('click', () => {
    const who = mine ? '이 글을' : `${displayName(post.author)}의 글을`;
    if (!confirm(`${who} 삭제할까요? 첨부 파일도 함께 지워지고, 되돌릴 수 없어요.`)) return;
    withBusy(deleteButton, async () => {
      try {
        await removeAllFiles(id);
      } catch (removeError) {
        status.replaceChildren(errorBox(removeError));
        return;
      }
      // .select() 로 실제로 지워진 줄을 돌려받는다. 권한이 없으면 0줄.
      const { data, error: deleteError } = await supabase.from('posts').delete().eq('id', id).select('id');
      if (deleteError) {
        status.replaceChildren(errorBox(deleteError));
      } else if (data.length === 0) {
        status.replaceChildren(message('삭제할 권한이 없어요.', 'error'));
      } else {
        location.hash = backHref;
      }
    });
  });

  const attachments = filesError ? errorBox(filesError) : await attachmentsSection(files);

  view.replaceChildren(
    el(
      'article',
      { class: 'card' },
      topic ? el('a', { class: 'topic-tag', href: backHref }, `📌 ${topic.title}`) : null,
      el('h1', { class: 'row-title' }, post.title),
      el(
        'div',
        { class: 'row-meta' },
        `${withRealName(displayName(post.author), post.author_id, names)} · ${formatDateTime(post.created_at)}${edited ? ' (고침)' : ''}`,
      ),
      el('p', { class: 'body-text' }, post.content),
      attachments,
      likeSection(id, likes, ctx),
      commentsSection(id, comments, ctx, names),
      el(
        'div',
        { class: 'actions' },
        el('a', { href: backHref }, backText),
        el('span', { class: 'spacer' }),
        mine ? el('a', { class: 'button', href: `#/board/${id}/edit` }, '수정') : null,
        canDelete ? deleteButton : null,
      ),
      status,
    ),
  );
}

// ---------- 공감 ----------

async function fetchLikes(postId) {
  const result = await supabase.from('post_likes').select('user_id, user:profiles!user_id(username, nickname)').eq('post_id', postId).order('created_at');
  // 공감 표가 아직 없으면(SQL 실행 전) 공감 칸을 숨김
  if (result.error?.code === 'PGRST205' || result.error?.code === 'PGRST200') return { missing: true };
  return result;
}

function likeSection(postId, likes, ctx) {
  if (likes.missing) return null;
  if (likes.error) return errorBox(likes.error);
  const list = likes.data;
  const liked = list.some((like) => like.user_id === ctx.user.id);
  const status = el('div');
  const button = el(
    'button',
    { type: 'button', class: `like-button ${liked ? 'liked' : ''}`, 'aria-pressed': liked ? 'true' : 'false' },
    `${liked ? '♥' : '♡'} 공감 ${list.length}`,
  );
  button.addEventListener('click', () =>
    withBusy(button, async () => {
      const { error } = liked
        ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', ctx.user.id)
        : await supabase.from('post_likes').insert({ post_id: postId });
      if (error) return status.replaceChildren(errorBox(error));
      ctx.refresh();
    }),
  );
  return el(
    'div',
    { class: 'likes' },
    button,
    list.length ? el('span', { class: 'row-meta' }, `공감한 친구: ${list.map((like) => displayName(like.user)).join(', ')}`) : null,
    status,
  );
}

// ---------- 댓글 ----------

const COMMENT_MAX = 500;

async function fetchComments(postId) {
  const result = await supabase
    .from('comments')
    .select('id, content, created_at, author_id, author:profiles!author_id(username, nickname)')
    .eq('post_id', postId)
    .order('created_at');
  // 댓글 표가 아직 없으면(SQL 실행 전) 댓글 칸을 숨김
  if (result.error?.code === 'PGRST205' || result.error?.code === 'PGRST200') return { missing: true };
  return result;
}

function commentItem(comment, ctx, names) {
  const status = el('div');
  const canDelete = comment.author_id === ctx.user.id || isAdmin(ctx.user);
  const deleteButton = canDelete ? el('button', { type: 'button', class: 'danger small' }, '삭제') : null;
  deleteButton?.addEventListener('click', () => {
    if (!confirm('이 댓글을 삭제할까요?')) return;
    withBusy(deleteButton, async () => {
      const { data, error } = await supabase.from('comments').delete().eq('id', comment.id).select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('삭제할 권한이 없어요.', 'error'));
        return;
      }
      ctx.refresh();
    });
  });
  return el(
    'li',
    {},
    el(
      'div',
      { class: 'item-head' },
      el('strong', {}, withRealName(displayName(comment.author), comment.author_id, names)),
      el('span', { class: 'row-meta' }, formatDateTime(comment.created_at)),
      el('span', { class: 'spacer' }),
      deleteButton,
    ),
    el('p', { class: 'body-text' }, comment.content),
    status,
  );
}

function commentsSection(postId, comments, ctx, names) {
  if (comments.missing) return null;
  if (comments.error) return errorBox(comments.error);
  const list = comments.data;

  const input = el('textarea', { id: 'comment-content', maxlength: String(COMMENT_MAX), required: true, rows: '3', placeholder: '댓글을 써 주세요. 친구를 기분 좋게 하는 말로!' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '댓글 등록');
  const form = el(
    'form',
    { class: 'comment-form' },
    el('label', { for: 'comment-content', class: 'sr-only' }, '댓글'),
    input,
    status,
    el('div', { class: 'actions' }, submit),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) {
      status.replaceChildren(message('댓글 내용을 써 주세요.', 'error'));
      return;
    }
    if (PHONE_PATTERN.test(content) && !confirm('전화번호처럼 보이는 숫자가 있어요.\n전화번호는 쓰지 않아요. 그래도 올릴까요?')) return;
    withBusy(submit, async () => {
      const { data, error } = await supabase.from('comments').insert({ post_id: postId, content }).select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('댓글을 올리지 못했어요.', 'error'));
        return;
      }
      ctx.refresh();
    });
  });

  return el(
    'section',
    { class: 'comments' },
    el('h2', {}, `댓글 ${list.length}`),
    list.length ? el('ul', { class: 'comment-list' }, list.map((comment) => commentItem(comment, ctx, names))) : message('아직 댓글이 없어요. 첫 댓글을 남겨 보세요.'),
    form,
  );
}

function countedField(id, labelText, input, max) {
  const counter = el('div', { class: 'char-count' });
  const update = () => {
    counter.textContent = `${input.value.length} / ${max}`;
  };
  input.addEventListener('input', update);
  update();
  return [el('label', { for: id }, labelText), input, counter];
}

async function renderForm(view, ctx, id) {
  let post = null;
  let topic = null;
  const topicParam = ctx.query.get('topic');
  if (id === null && /^\d+$/.test(topicParam ?? '')) {
    const { data, error } = await supabase.from('topics').select('id, title, is_open').eq('id', Number(topicParam)).maybeSingle();
    if (error || !data) {
      view.append(error ? errorBox(error) : message('없는 주제예요.'), el('a', { href: '#/topics' }, '보드 목록으로'));
      return;
    }
    if (!data.is_open && !isAdmin(ctx.user)) {
      view.append(message('마감된 주제라 글을 쓸 수 없어요.', 'error'), el('a', { href: `#/topics/${data.id}` }, '주제로 돌아가기'));
      return;
    }
    topic = data;
  }
  let existingFiles = [];
  if (id !== null) {
    view.append(loading());
    const [{ data, error }, { data: files, error: filesError }] = await Promise.all([
      supabase.from('posts').select('id, title, content, author_id').eq('id', id).maybeSingle(),
      listFiles(id),
    ]);
    view.replaceChildren();
    if (error || filesError) {
      view.append(errorBox(error ?? filesError));
      return;
    }
    if (!data) {
      view.append(message('없는 글이에요.'), el('a', { href: '#/board' }, '목록으로'));
      return;
    }
    if (data.author_id !== ctx.user.id) {
      view.append(message('내가 쓴 글만 고칠 수 있어요.', 'error'), el('a', { href: `#/board/${id}` }, '돌아가기'));
      return;
    }
    post = data;
    existingFiles = files;
  }

  const titleInput = el('input', { id: 'post-title', maxlength: String(TITLE_MAX), required: true, value: post?.title ?? '' });
  const contentInput = el('textarea', { id: 'post-content', maxlength: String(CONTENT_MAX), required: true }, post?.content ?? '');
  const picker = filePicker(existingFiles);
  const status = el('div');
  const submit = el('button', { type: 'submit' }, post ? '고친 글 저장' : '올리기');

  const form = el(
    'form',
    { class: 'card' },
    message('⚠️ 친구 이름, 전화번호, 주소는 쓰지 않아요. 친구 얼굴이 나온 사진은 친구에게 먼저 물어보고 올려요.', 'warn'),
    countedField('post-title', '제목', titleInput, TITLE_MAX),
    countedField('post-content', '내용', contentInput, CONTENT_MAX),
    picker.element,
    status,
    el(
      'div',
      { class: 'actions' },
      submit,
      el('a', { href: post ? `#/board/${id}` : topic ? `#/topics/${topic.id}` : '#/board', class: 'muted' }, '취소'),
    ),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = { title: titleInput.value.trim(), content: contentInput.value.trim() };
    if (!values.title || !values.content) {
      status.replaceChildren(message('제목과 내용을 모두 써 주세요.', 'error'));
      return;
    }
    if (PHONE_PATTERN.test(`${values.title} ${values.content}`)) {
      const ok = confirm('전화번호처럼 보이는 숫자가 있어요.\n전화번호는 게시판에 쓰지 않아요. 그래도 올릴까요?');
      if (!ok) return;
    }

    withBusy(submit, async () => {
      status.replaceChildren(message('저장하는 중…'));
      const query = post
        ? supabase.from('posts').update(values).eq('id', id).select('id')
        : supabase.from('posts').insert(topic ? { ...values, topic_id: topic.id } : values).select('id');
      const { data, error } = await query;
      if (error) {
        status.replaceChildren(errorBox(error));
        return;
      }
      if (data.length === 0) {
        status.replaceChildren(message('저장할 권한이 없어요.', 'error'));
        return;
      }
      const postId = data[0].id;

      const failures = [];
      for (const file of picker.removed) {
        try {
          await removeFile(file);
        } catch (removeError) {
          failures.push(`${file.name}: 빼지 못했어요. (${removeError.message})`);
        }
      }
      failures.push(
        ...(await uploadFiles(ctx.user.id, postId, picker.added, (text) => status.replaceChildren(message(text)))),
      );

      if (failures.length) alert(`글은 저장했지만 파일 일부에 문제가 있었어요.\n\n${failures.join('\n')}`);
      location.hash = `#/board/${postId}`;
    });
  });

  view.append(el('h1', {}, post ? '글 고치기' : '글쓰기'));
  if (topic) view.append(el('p', { class: 'topic-tag' }, `📌 주제: ${topic.title}`));
  view.append(form);
  titleInput.focus();
}
