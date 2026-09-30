import { isAdmin } from '../auth.js';
import { fetchMeals } from '../meal.js';
import { el, errorBox, formatDate, loading, message, today } from '../ui.js';
import { fetchLessons, lessonHeading } from './lessons.js';
import { dueBadge, fetchUpcomingHomework } from './homework.js';
import { dishList } from './meal.js';

export const title = '홈';

// 오늘의 수업 · 가까운 숙제 · 오늘 급식을 한눈에 (세 칸이 각자 따로 불러옴)
export function render(view, ctx) {
  const name = isAdmin(ctx.user) ? '선생님' : `${ctx.user.nickname ?? ctx.user.username}님`;

  const lessonsBox = el('div', {}, loading());
  const homeworkBox = el('div', {}, loading());
  const mealBox = el('div', {}, loading());

  view.append(
    el('h1', {}, `안녕하세요, ${name}!`),
    el('p', { class: 'muted' }, `오늘은 ${formatDate(today())}이에요.`),
    ctx.user.profileMissing
      ? message('계정 정보(profiles)를 찾지 못했어요. 선생님께 알려 주세요.', 'warn')
      : null,
    el(
      'div',
      { class: 'home-grid' },
      section('#/lessons', '오늘의 수업', lessonsBox),
      section('#/homework', '다가오는 숙제', homeworkBox),
      section('#/meal', '오늘 급식', mealBox),
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
  try {
    const meals = await fetchMeals(today());
    const lunch = meals.find((meal) => meal.type === '중식') ?? meals[0];
    box.replaceChildren(lunch ? dishList(lunch) : message('오늘은 급식 정보가 없어요.'));
  } catch (error) {
    box.replaceChildren(message(error.message, 'error'));
  }
}
