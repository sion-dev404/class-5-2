import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
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

  const { data, error, count } = await supabase
    .from('posts')
    .select('id, title, created_at, author:profiles(username, nickname)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    body.replaceChildren(errorBox(error));
    return;
  }
  if (data.length === 0) {
    body.replaceChildren(message(page === 1 ? '아직 글이 없어요. 첫 글을 써 볼까요?' : '이 쪽에는 글이 없어요.'));
    return;
  }

  const list = el(
    'ul',
    { class: 'list' },
    data.map((post) =>
      el(
        'li',
        {},
        el(
          'a',
          { class: 'row-link', href: `#/board/${post.id}` },
          el('div', { class: 'row-title' }, post.title),
          el('div', { class: 'row-meta' }, `${displayName(post.author)} · ${formatDateTime(post.created_at)}`),
        ),
      ),
    ),
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

  const { data: post, error } = await supabase
    .from('posts')
    .select('id, title, content, created_at, updated_at, author_id, author:profiles(username, nickname)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    view.replaceChildren(errorBox(error));
    return;
  }
  if (!post) {
    view.replaceChildren(message('없는 글이에요. 지워졌을 수도 있어요.'), el('a', { href: '#/board' }, '목록으로'));
    return;
  }

  const mine = post.author_id === ctx.user.id;
  const canDelete = mine || isAdmin(ctx.user);
  const edited = new Date(post.updated_at) - new Date(post.created_at) > 1000;
  const status = el('div');

  const deleteButton = el('button', { type: 'button', class: 'danger' }, '삭제');
  deleteButton.addEventListener('click', () => {
    const who = mine ? '이 글을' : `${displayName(post.author)}의 글을`;
    if (!confirm(`${who} 삭제할까요? 되돌릴 수 없어요.`)) return;
    withBusy(deleteButton, async () => {
      // .select() 로 실제로 지워진 줄을 돌려받는다. 권한이 없으면 0줄.
      const { data, error: deleteError } = await supabase.from('posts').delete().eq('id', id).select('id');
      if (deleteError) {
        status.replaceChildren(errorBox(deleteError));
      } else if (data.length === 0) {
        status.replaceChildren(message('삭제할 권한이 없어요.', 'error'));
      } else {
        location.hash = '#/board';
      }
    });
  });

  view.replaceChildren(
    el(
      'article',
      { class: 'card' },
      el('h1', { class: 'row-title' }, post.title),
      el(
        'div',
        { class: 'row-meta' },
        `${displayName(post.author)} · ${formatDateTime(post.created_at)}${edited ? ' (고침)' : ''}`,
      ),
      el('p', { class: 'body-text' }, post.content),
      el(
        'div',
        { class: 'actions' },
        el('a', { href: '#/board' }, '목록으로'),
        el('span', { class: 'spacer' }),
        mine ? el('a', { class: 'button', href: `#/board/${id}/edit` }, '수정') : null,
        canDelete ? deleteButton : null,
      ),
      status,
    ),
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
  if (id !== null) {
    view.append(loading());
    const { data, error } = await supabase.from('posts').select('id, title, content, author_id').eq('id', id).maybeSingle();
    view.replaceChildren();
    if (error) {
      view.append(errorBox(error));
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
  }

  const titleInput = el('input', { id: 'post-title', maxlength: String(TITLE_MAX), required: true, value: post?.title ?? '' });
  const contentInput = el('textarea', { id: 'post-content', maxlength: String(CONTENT_MAX), required: true }, post?.content ?? '');
  const status = el('div');
  const submit = el('button', { type: 'submit' }, post ? '고친 글 저장' : '올리기');

  const form = el(
    'form',
    { class: 'card' },
    message('⚠️ 친구 이름, 전화번호, 주소, 사진은 쓰지 않아요. 모두가 기분 좋은 글을 써요.', 'warn'),
    countedField('post-title', '제목', titleInput, TITLE_MAX),
    countedField('post-content', '내용', contentInput, CONTENT_MAX),
    status,
    el(
      'div',
      { class: 'actions' },
      submit,
      el('a', { href: post ? `#/board/${id}` : '#/board', class: 'muted' }, '취소'),
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
      const query = post
        ? supabase.from('posts').update(values).eq('id', id).select('id')
        : supabase.from('posts').insert(values).select('id');
      const { data, error } = await query;
      if (error) {
        status.replaceChildren(errorBox(error));
      } else if (data.length === 0) {
        status.replaceChildren(message('저장할 권한이 없어요.', 'error'));
      } else {
        location.hash = `#/board/${data[0].id}`;
      }
    });
  });

  view.append(el('h1', {}, post ? '글 고치기' : '글쓰기'), form);
  titleInput.focus();
}
