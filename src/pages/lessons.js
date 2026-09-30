import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { dateNav, el, errorBox, formatDate, isDateStr, loading, message, today, withBusy } from '../ui.js';

export const title = '오늘의 수업';

// #/lessons?date=2026-09-30
export async function render(view, ctx) {
  const date = isDateStr(ctx.query.get('date')) ? ctx.query.get('date') : today();
  const admin = isAdmin(ctx.user);

  const listBox = el('div', {}, loading());
  view.append(
    el('h1', {}, '오늘의 수업'),
    dateNav('/lessons', date),
    el('h2', {}, date === today() ? `${formatDate(date)} · 오늘` : formatDate(date)),
    listBox,
  );

  const { data: lessons, error } = await fetchLessons(date);
  if (error) {
    listBox.replaceChildren(errorBox(error));
    return;
  }

  const form = admin ? lessonForm(date, ctx.refresh) : null;

  listBox.replaceChildren(
    lessons.length === 0
      ? message('이 날은 등록된 수업이 없어요.')
      : el(
          'ul',
          { class: 'list' },
          lessons.map((lesson) => lessonItem(lesson, admin ? form : null, ctx.refresh)),
        ),
  );
  if (form) view.append(form.element);
}

export function fetchLessons(date) {
  return supabase
    .from('lessons')
    .select('id, lesson_date, period, subject, content')
    .eq('lesson_date', date)
    .order('period', { ascending: true, nullsFirst: false })
    .order('id');
}

export function lessonHeading(lesson) {
  return lesson.period ? `${lesson.period}교시 · ${lesson.subject}` : lesson.subject;
}

function lessonItem(lesson, form, refresh) {
  const status = el('div');
  const li = el(
    'li',
    {},
    el('div', { class: 'row-title' }, lessonHeading(lesson)),
    el('p', { class: 'body-text' }, lesson.content),
    status,
  );
  if (!form) return li;

  const deleteButton = el('button', { type: 'button', class: 'danger small' }, '삭제');
  deleteButton.addEventListener('click', () => {
    if (!confirm(`"${lessonHeading(lesson)}" 수업을 삭제할까요?`)) return;
    withBusy(deleteButton, async () => {
      const { data, error } = await supabase.from('lessons').delete().eq('id', lesson.id).select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('삭제할 권한이 없어요.', 'error'));
        return;
      }
      refresh();
    });
  });

  li.append(
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'button', class: 'secondary small', onclick: () => form.edit(lesson) }, '수정'),
      deleteButton,
    ),
  );
  return li;
}

// 관리자용 입력 칸 (추가/수정 겸용)
function lessonForm(date, refresh) {
  let editingId = null;

  const heading = el('h2', {}, '수업 추가');
  const dateInput = el('input', { id: 'lesson-date', type: 'date', required: true, value: date });
  const periodInput = el(
    'select',
    { id: 'lesson-period' },
    el('option', { value: '' }, '(교시 없음)'),
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => el('option', { value: String(n) }, `${n}교시`)),
  );
  const subjectInput = el('input', { id: 'lesson-subject', maxlength: '20', required: true, placeholder: '예: 국어' });
  const contentInput = el('textarea', { id: 'lesson-content', maxlength: '2000', required: true, placeholder: '배운 내용, 준비물 등' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '추가');
  const cancel = el('button', { type: 'button', class: 'secondary', hidden: true }, '수정 취소');

  const element = el(
    'form',
    { class: 'card' },
    heading,
    el(
      'div',
      { class: 'field-row' },
      el('div', {}, el('label', { for: 'lesson-date' }, '날짜'), dateInput),
      el('div', {}, el('label', { for: 'lesson-period' }, '교시'), periodInput),
      el('div', {}, el('label', { for: 'lesson-subject' }, '과목'), subjectInput),
    ),
    el('label', { for: 'lesson-content' }, '내용'),
    contentInput,
    status,
    el('div', { class: 'actions' }, submit, cancel),
  );

  function reset() {
    editingId = null;
    heading.textContent = '수업 추가';
    submit.textContent = '추가';
    cancel.hidden = true;
    element.reset();
    dateInput.value = date;
    status.replaceChildren();
  }

  cancel.addEventListener('click', reset);

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = {
      lesson_date: dateInput.value,
      period: periodInput.value ? Number(periodInput.value) : null,
      subject: subjectInput.value.trim(),
      content: contentInput.value.trim(),
    };
    if (!isDateStr(values.lesson_date) || !values.subject || !values.content) {
      status.replaceChildren(message('날짜, 과목, 내용을 모두 입력해 주세요.', 'error'));
      return;
    }
    withBusy(submit, async () => {
      const query = editingId
        ? supabase.from('lessons').update(values).eq('id', editingId).select('id')
        : supabase.from('lessons').insert(values).select('id');
      const { data, error } = await query;
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('저장할 권한이 없어요.', 'error'));
        return;
      }
      // 다른 날짜로 저장했다면 그 날짜로 이동
      if (values.lesson_date !== date) location.hash = `#/lessons?date=${values.lesson_date}`;
      else refresh();
    });
  });

  return {
    element,
    edit(lesson) {
      editingId = lesson.id;
      heading.textContent = '수업 수정';
      submit.textContent = '수정 저장';
      cancel.hidden = false;
      dateInput.value = lesson.lesson_date;
      periodInput.value = lesson.period ? String(lesson.period) : '';
      subjectInput.value = lesson.subject;
      contentInput.value = lesson.content;
      status.replaceChildren();
      element.scrollIntoView({ behavior: 'smooth' });
      subjectInput.focus();
    },
  };
}
