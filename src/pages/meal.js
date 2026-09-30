import { ALLERGENS, fetchMeals } from '../meal.js';
import { SCHOOL } from '../config.js';
import { dateNav, el, formatDate, isDateStr, loading, message, today } from '../ui.js';

export const title = '식단';

// #/meal?date=2026-09-30
export async function render(view, ctx) {
  const date = isDateStr(ctx.query.get('date')) ? ctx.query.get('date') : today();
  const box = el('div', {}, loading());

  view.append(
    el('h1', {}, '식단'),
    dateNav('/meal', date),
    el('h2', {}, date === today() ? `${formatDate(date)} · 오늘` : formatDate(date)),
    box,
    allergenLegend(),
    message(`출처: 나이스 교육정보 개방 포털 (${SCHOOL.name})`),
  );

  try {
    const meals = await fetchMeals(date);
    box.replaceChildren(
      ...(meals.length === 0 ? [message('이 날은 급식 정보가 없어요.')] : meals.map((meal) => mealCard(meal))),
    );
  } catch (error) {
    box.replaceChildren(message(error.message, 'error'));
  }
}

export function mealCard(meal, { showType = true } = {}) {
  return el(
    'section',
    { class: 'card' },
    showType ? el('h2', {}, meal.type) : null,
    dishList(meal),
    meal.calories ? el('div', { class: 'row-meta' }, meal.calories) : null,
  );
}

export function dishList(meal) {
  return el(
    'ul',
    { class: 'dishes' },
    meal.dishes.map((dish) =>
      el(
        'li',
        {},
        dish.name,
        dish.allergens.length
          ? el(
              'span',
              { class: 'allergens', title: dish.allergens.map((n) => ALLERGENS[n - 1]).join(', ') },
              dish.allergens.join('.'),
            )
          : null,
      ),
    ),
  );
}

function allergenLegend() {
  return el(
    'details',
    { class: 'legend card' },
    el('summary', {}, '알레르기 번호 보기'),
    el('p', {}, ALLERGENS.map((name, i) => `${i + 1}.${name}`).join('  ')),
  );
}
