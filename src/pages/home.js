import { isAdmin } from '../auth.js';
import { calendarSection } from '../calendar.js';
import { fetchMeal } from '../meal.js';
import { el, errorBox, formatDate, loading, message, today } from '../ui.js';
import { fetchLessons, lessonHeading } from './lessons.js';
import { dueBadge, fetchUpcomingHomework } from './homework.js';
import { dishList } from './meal.js';

export const title = '홈';

// 오늘의 수업 · 가까운 숙제 · 오늘 급식 · 캘린더를 한눈에 (칸마다 따로 불러옴)
export function render(view, ctx) {
  const name = isAdmin(ctx.user) ? '선생님' : `${ctx.user.nickname ?? ctx.user.username}님`;

  const lessonsBox = el('div', {}, loading());
  const homeworkBox = el('div', {}, loading());
  const mealBox = el('div', {}, loading());

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
        section('#/homework', '다가오는 숙제', homeworkBox),
        section('#/meal', '오늘 급식', mealBox),
      ),
      calendarSection(ctx),
    ),
  );

  loadLessons(lessonsBox);
  loadHomework(homeworkBox);
  loadMeal(mealBox);
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

async function loadHomework(box) {
  const { data, error } = await fetchUpcomingHomework(3);
  if (error) return box.replaceChildren(errorBox(error));
  box.replaceChildren(
    data.length === 0
      ? message('해야 할 숙제가 없어요. 🎉')
      : el(
          'ul',
          { class: 'list' },
          data.map((item) =>
            el('li', {}, el('div', { class: 'item-head' }, dueBadge(item.due_date), el('span', {}, item.title))),
          ),
        ),
  );
}

async function loadMeal(box) {
  const { data: meal, error } = await fetchMeal(today());
  if (error) return box.replaceChildren(errorBox(error));
  if (!meal) return box.replaceChildren(message('오늘은 등록된 급식이 없어요.'));
  // 메뉴 글이 있으면 글, 사진만 올렸으면 급식 화면으로 가는 안내
  box.replaceChildren(meal.menu ? dishList(meal.menu) : el('a', { href: '#/meal' }, '📷 오늘 식단표 사진 보기 ›'));
}
