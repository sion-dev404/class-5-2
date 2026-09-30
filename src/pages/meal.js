import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { fetchMeal, menuItems } from '../meal.js';
import { dateNav, el, errorBox, formatDate, isDateStr, loading, message, today, withBusy } from '../ui.js';

export const title = '식단';

// #/meal?date=2026-10-01
export async function render(view, ctx) {
  const date = isDateStr(ctx.query.get('date')) ? ctx.query.get('date') : today();
  const box = el('div', {}, loading());

  view.append(
    el('h1', {}, '식단'),
    dateNav('/meal', date),
    el('h2', {}, date === today() ? `${formatDate(date)} · 오늘` : formatDate(date)),
    box,
  );

  const { data: meal, error } = await fetchMeal(date);
  if (error) {
    box.replaceChildren(errorBox(error));
    return;
  }

  box.replaceChildren(
    meal ? el('section', { class: 'card' }, dishList(meal.menu)) : message('이 날은 등록된 급식이 없어요.'),
  );
  if (isAdmin(ctx.user)) view.append(mealForm(date, meal, ctx.refresh));
}

export function dishList(menu) {
  return el(
    'ul',
    { class: 'dishes' },
    menuItems(menu).map((item) => el('li', {}, item)),
  );
}

// 관리자용: 그날 메뉴 입력·수정·삭제
function mealForm(date, meal, refresh) {
  const menuInput = el(
    'textarea',
    { id: 'meal-menu', maxlength: '1000', required: true, placeholder: '한 줄에 한 가지씩\n예)\n쌀밥\n미역국\n불고기\n배추김치\n우유' },
    meal?.menu ?? '',
  );
  const status = el('div');
  const submit = el('button', { type: 'submit' }, meal ? '수정 저장' : '저장');
  const deleteButton = meal ? el('button', { type: 'button', class: 'danger' }, '삭제') : null;

  const form = el(
    'form',
    { class: 'card' },
    el('h2', {}, meal ? '급식 수정' : '급식 입력'),
    el('label', { for: 'meal-menu' }, `${formatDate(date)} 메뉴`),
    menuInput,
    status,
    el('div', { class: 'actions' }, submit, deleteButton),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const menu = menuItems(menuInput.value).join('\n');
    if (!menu) {
      status.replaceChildren(message('메뉴를 입력해 주세요.', 'error'));
      return;
    }
    withBusy(submit, async () => {
      // 그날 급식이 있으면 고치고, 없으면 새로 만든다
      const { data, error } = await supabase
        .from('meals')
        .upsert({ meal_date: date, menu }, { onConflict: 'meal_date' })
        .select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('저장할 권한이 없어요.', 'error'));
        return;
      }
      refresh();
    });
  });

  deleteButton?.addEventListener('click', () => {
    if (!confirm(`${formatDate(date)} 급식을 삭제할까요?`)) return;
    withBusy(deleteButton, async () => {
      const { data, error } = await supabase.from('meals').delete().eq('id', meal.id).select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('삭제할 권한이 없어요.', 'error'));
        return;
      }
      refresh();
    });
  });

  return form;
}
