import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { listContentFiles, removeAllContentFiles, removeContentFile, uploadContentFiles } from '../files.js';
import { attachmentsSection, filePicker } from '../attachments.js';
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
  let files;
  try {
    files = await listContentFiles('lesson', lessons.map((lesson) => lesson.id));
  } catch (filesError) {
    listBox.replaceChildren(errorBox(filesError));
    return;
  }

  const form = admin ? lessonForm(date, ctx.refresh) : null;
  const items = await Promise.all(lessons.map((lesson) => lessonItem(lesson, files.get(lesson.id) ?? [], form, ctx.refresh)));

  listBox.replaceChildren(lessons.length === 0 ? message('이 날은 등록된 수업이 없어요.') : el('ul', { class: 'list' }, items));
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

async function lessonItem(lesson, files, form, refresh) {
  const status = el('div');
  const li = el(
    'li',
    {},
    el('div', { class: 'row-title' }, lessonHeading(lesson)),
    lesson.content ? el('p', { class: 'body-text' }, lesson.content) : null,
    await attachmentsSection(files),
    status,
  );
  if (!form) return li;

  const deleteButton = el('button', { type: 'button', class: 'danger small' }, '삭제');
  deleteButton.addEventListener('click', () => {
    if (!confirm(`"${lessonHeading(lesson)}" 수업을 삭제할까요?${files.length ? ' 사진·파일도 함께 지워져요.' : ''}`)) return;
    withBusy(deleteButton, async () => {
      try {
        await removeAllContentFiles('lesson', lesson.id);
      } catch (removeError) {
        status.replaceChildren(errorBox(removeError));
        return;
      }
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
      el('button', { type: 'button', class: 'secondary small', onclick: () => form.edit(lesson, files) }, '수정'),
      deleteButton,
    ),
  );
  return li;
}

// 관리자용 입력 칸 (추가/수정 겸용). 내용 글과 사진·파일 중 하나 이상
function lessonForm(date, refresh) {
  let editingId = null;
  let picker = filePicker([], { id: 'lesson-files', label: '사진·파일' });

  const heading = el('h2', {}, '수업 추가');
  const dateInput = el('input', { id: 'lesson-date', type: 'date', required: true, value: date });
  const periodInput = el(
    'select',
    { id: 'lesson-period' },
    el('option', { value: '' }, '(교시 없음)'),
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => el('option', { value: String(n) }, `${n}교시`)),
  );
  const subjectInput = el('input', { id: 'lesson-subject', maxlength: '20', required: true, placeholder: '예: 국어' });
  const contentInput = el('textarea', { id: 'lesson-content', maxlength: '2000', placeholder: '배운 내용, 준비물 등 (사진만 올려도 돼요)' });
  const pickerBox = el('div', {}, picker.element);
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
    el('label', { for: 'lesson-content' }, '내용 (선택)'),
    contentInput,
    pickerBox,
    status,
    el('div', { class: 'actions' }, submit, cancel),
  );

  const setPicker = (existing) => {
    picker = filePicker(existing, { id: 'lesson-files', label: '사진·파일' });
    pickerBox.replaceChildren(picker.element);
  };

  function reset() {
    editingId = null;
    heading.textContent = '수업 추가';
    submit.textContent = '추가';
    cancel.hidden = true;
    element.reset();
    dateInput.value = date;
    setPicker([]);
    status.replaceChildren();
  }

  cancel.addEventListener('click', reset);

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = {
      lesson_date: dateInput.value,
      period: periodInput.value ? Number(periodInput.value) : null,
      subject: subjectInput.value.trim(),
      content: contentInput.value.trim() || null,
    };
    if (!isDateStr(values.lesson_date) || !values.subject) {
      status.replaceChildren(message('날짜와 과목을 입력해 주세요.', 'error'));
      return;
    }
    if (!values.content && picker.count === 0) {
      status.replaceChildren(message('내용을 쓰거나 사진·파일을 올려 주세요.', 'error'));
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
      const lessonId = data[0].id;
      const failures = [];
      for (const file of picker.removed) {
        try {
          await removeContentFile(file);
        } catch (removeError) {
          failures.push(`${file.name}: 빼지 못했어요. (${removeError.message})`);
        }
      }
      failures.push(...(await uploadContentFiles('lesson', lessonId, picker.added, (text) => status.replaceChildren(message(text)))));
      if (failures.length) alert(`수업은 저장했지만 파일 일부에 문제가 있었어요.\n\n${failures.join('\n')}`);
      // 다른 날짜로 저장했다면 그 날짜로 이동
      if (values.lesson_date !== date) location.hash = `#/lessons?date=${values.lesson_date}`;
      else refresh();
    });
  });

  return {
    element,
    edit(lesson, files) {
      editingId = lesson.id;
      heading.textContent = '수업 수정';
      submit.textContent = '수정 저장';
      cancel.hidden = false;
      dateInput.value = lesson.lesson_date;
      periodInput.value = lesson.period ? String(lesson.period) : '';
      subjectInput.value = lesson.subject;
      contentInput.value = lesson.content ?? '';
      setPicker(files);
      status.replaceChildren();
      element.scrollIntoView({ behavior: 'smooth' });
      subjectInput.focus();
    },
  };
}
