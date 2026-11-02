import { isAdmin } from '../auth.js';
import { realNames } from '../realnames.js';
import { el, errorBox, formatDate, loading, message, today } from '../ui.js';
import { fetchLessons, lessonHeading } from './lessons.js';
import { fetchPopular, popularList } from './popular.js';

export const title = '홈';

// 오늘의 수업 · 이달의 인기글을 한눈에 (칸마다 따로 불러옴)
export function render(view, ctx) {
  const name = isAdmin(ctx.user) ? '선생님' : `${ctx.user.nickname ?? ctx.user.username}님`;

  const lessonsBox = el('div', {}, loading());
  const popularBox = el('div', {}, loading());

  view.append(
    el('h1', {}, `안녕하세요, ${name}!`),
    el('p', { class: 'muted' }, `오늘은 ${formatDate(today())}이에요.`),
  );
  if (ctx.user.profileMissing) {
    view.append(message('계정 정보(profiles)를 찾지 못했어요. 선생님께 알려 주세요.', 'warn'));
  } else if (!ctx.user.nickname) {
    view.append(
      el(
        'p',
        { class: 'ok' },
        '아직 별명이 없어요. 게시판에 아이디 대신 별명이 보이게 할 수 있어요. ',
        el('a', { href: '#/me' }, '✏️ 별명 정하기'),
      ),
    );
  }
  view.append(
    el(
      'div',
      { class: 'home-grid' },
      el(
        'div',
        { class: 'home-left' },
        section('#/lessons', '오늘의 수업', lessonsBox),
        section('#/popular', '이달의 인기글', popularBox),
      ),
    ),
  );

  loadLessons(lessonsBox);
  loadPopular(popularBox, ctx);
}

function section(href, heading, body) {
  return el('section', { class: 'card' }, el('h2', {}, el('a', { href }, `${heading} ›`)), body);
}

async function loadLessons(box) {
  const { data, error } = await fetchLessons(today());
  if (error) return box.replaceChildren(errorBox(error));
  box.replaceChildren(
    data.length === 0
      ? message('오늘 등록된 수업이 없어요.')
      : el('ul', { class: 'list' }, data.map((lesson) => el('li', {}, lessonHeading(lesson)))),
  );
}

async function loadPopular(box, ctx) {
  const [{ data, error }, names] = await Promise.all([fetchPopular(), realNames(ctx.user)]);
  if (error) return box.replaceChildren(errorBox(error));
  box.replaceChildren(data.length === 0 ? message('이번 달에는 아직 공감을 받은 글이 없어요.') : popularList(data, names));
}
