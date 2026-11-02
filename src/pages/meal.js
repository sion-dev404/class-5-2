import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { fetchMeal, menuItems } from '../meal.js';
import { listContentFiles, removeAllContentFiles, removeContentFile, uploadContentFiles } from '../files.js';
import { attachmentsSection, filePicker } from '../attachments.js';
import { dateNav, el, errorBox, formatDate, isDateStr, loading, message, today, withBusy } from '../ui.js';

export const title = '급식';

// #/meal?date=2026-10-01 : 그날 급식 (식단표 사진·파일 + 메뉴 글)
export async function render(view, ctx) {
  const date = isDateStr(ctx.query.get('date')) ? ctx.query.get('date') : today();
  const box = el('div', {}, loading());

  view.append(
    el('h1', {}, '급식'),
    dateNav('/meal', date),
    el('h2', {}, date === today() ? `${formatDate(date)} · 오늘` : formatDate(date)),
    box,
  );

  const { data: meal, error } = await fetchMeal(date);
  if (error) {
    box.replaceChildren(errorBox(error));
    return;
  }
  let files = [];
  try {
    if (meal) files = (await listContentFiles('meal', [meal.id])).get(meal.id) ?? [];
  } catch (filesError) {
    box.replaceChildren(errorBox(filesError));
    return;
  }

  box.replaceChildren(
    meal
      ? el('section', { class: 'card' }, meal.menu ? dishList(meal.menu) : null, await attachmentsSection(files))
      : message('이 날은 등록된 급식이 없어요.'),
  );
  if (isAdmin(ctx.user)) view.append(mealForm(date, meal, files, ctx.refresh));
}

export function dishList(menu) {
  return el(
    'ul',
    { class: 'dishes' },
    menuItems(menu ?? '').map((item) => el('li', {}, item)),
  );
}

// 관리자용: 그날 급식 사진·파일과 메뉴 글(선택) 입력·수정·삭제
function mealForm(date, meal, files, refresh) {
  const picker = filePicker(files, { id: 'meal-files', label: '식단표 사진·파일' });
  const menuInput = el(
    'textarea',
    { id: 'meal-menu', maxlength: '1000', placeholder: '(선택) 한 줄에 한 가지씩\n예)\n쌀밥\n미역국\n불고기' },
    meal?.menu ?? '',
  );
  const status = el('div');
  const submit = el('button', { type: 'submit' }, meal ? '수정 저장' : '저장');
  const deleteButton = meal ? el('button', { type: 'button', class: 'danger' }, '삭제') : null;

  const form = el(
    'form',
    { class: 'card' },
    el('h2', {}, meal ? '급식 수정' : '급식 올리기'),
    picker.element,
    el('label', { for: 'meal-menu' }, `${formatDate(date)} 메뉴 글 (선택)`),
    menuInput,
    status,
    el('div', { class: 'actions' }, submit, deleteButton),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const menu = menuItems(menuInput.value).join('\n') || null;
    if (!menu && picker.count === 0) {
      status.replaceChildren(message('식단표 사진·파일을 올리거나 메뉴를 써 주세요.', 'error'));
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
      const mealId = data[0].id;
      const failures = [];
      for (const file of picker.removed) {
        try {
          await removeContentFile(file);
        } catch (removeError) {
          failures.push(`${file.name}: 빼지 못했어요. (${removeError.message})`);
        }
      }
      failures.push(...(await uploadContentFiles('meal', mealId, picker.added, (text) => status.replaceChildren(message(text)))));
      if (failures.length) alert(`급식은 저장했지만 파일 일부에 문제가 있었어요.\n\n${failures.join('\n')}`);
      refresh();
    });
  });

  deleteButton?.addEventListener('click', () => {
    if (!confirm(`${formatDate(date)} 급식을 삭제할까요?${files.length ? ' 사진·파일도 함께 지워져요.' : ''}`)) return;
    withBusy(deleteButton, async () => {
      try {
        await removeAllContentFiles('meal', meal.id);
      } catch (removeError) {
        status.replaceChildren(errorBox(removeError));
        return;
      }
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
