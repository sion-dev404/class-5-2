import { supabase } from '../supabase.js';
import { realNames, withRealName } from '../realnames.js';
import { displayName, el, errorBox, formatDateTime, loading, message } from '../ui.js';

export const title = '이달의 인기글';

const TOP = 3; // 이달의 인기글은 3등까지만 뽑음
const MEDALS = ['🥇', '🥈', '🥉'];

// 이번 달에 쓴 게시판 글 중 공감이 많은 순 (공감이 같으면 댓글이 많은 순, 그다음 최근 글)
export async function fetchPopular(limit = TOP) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data, error } = await supabase
    .from('posts')
    .select('id, title, created_at, author_id, author:profiles!author_id(username, nickname), comments(count), post_likes(count)')
    .is('topic_id', null)
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return { error };
  const posts = data
    .map((post) => ({ ...post, likeCount: post.post_likes?.[0]?.count ?? 0, commentCount: post.comments?.[0]?.count ?? 0 }))
    .filter((post) => post.likeCount > 0)
    .sort((a, b) => b.likeCount - a.likeCount || b.commentCount - a.commentCount)
    .slice(0, limit);
  return { data: posts };
}

// 한 줄: 등수 · 제목 · 공감/댓글 수 · 글쓴이
export function popularList(posts, names) {
  return el(
    'ol',
    { class: 'list popular-list' },
    posts.map((post, index) =>
      el(
        'li',
        {},
        el(
          'a',
          { class: 'row-link', href: `#/board/${post.id}` },
          el(
            'div',
            { class: 'row-title' },
            el('span', { class: 'popular-rank', title: `${index + 1}등` }, MEDALS[index] ?? `${index + 1}`),
            post.title,
            el('span', { class: 'like-count', title: `공감 ${post.likeCount}개` }, ` ♥${post.likeCount}`),
            post.commentCount ? el('span', { class: 'comment-count', title: `댓글 ${post.commentCount}개` }, ` [${post.commentCount}]`) : null,
          ),
          el('div', { class: 'row-meta' }, `${withRealName(displayName(post.author), post.author_id, names)} · ${formatDateTime(post.created_at)}`),
        ),
      ),
    ),
  );
}

export async function render(view, ctx) {
  const month = new Date().getMonth() + 1;
  view.append(el('h1', {}, `${month}월의 인기글 TOP 3`), el('p', { class: 'muted' }, '이번 달에 쓴 글 중 공감(♥)을 가장 많이 받은 3개를 뽑아요. 마음에 드는 글에 공감을 눌러 주세요!'));
  const body = el('div', {}, loading());
  view.append(body);
  const [{ data, error }, names] = await Promise.all([fetchPopular(TOP), realNames(ctx.user)]);
  if (error) return body.replaceChildren(errorBox(error));
  body.replaceChildren(data.length === 0 ? message('이번 달에는 아직 공감을 받은 글이 없어요.') : popularList(data, names));
}
