import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { daysUntil, el, errorBox, formatDate, isDateStr, loading, message, today, withBusy } from '../ui.js';

export const title = '숙제';

// #/homework          → 마감 안 지난 숙제
// #/homework?past=1   → 마감 지난 숙제
export async function render(view, ctx) {
  const showPast = ctx.query.get('past') === '1';
  const admin = isAdmin(ctx.user);

  const listBox = el('div', {}, loading());
  view.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h1', {}, showPast ? '지난 숙제' : '숙제'),
      el('span', { class: 'spacer' }),
      el('a', { href: showPast ? '#/homework' : '#/homework?past=1' }, showPast ? '해야 할 숙제 보기' : '지난 숙제 보기'),
    ),
    listBox,
  );

  const { data: items, error } = showPast ? await fetchPastHomework() : await fetchUpcomingHomework();
  if (error) {
    listBox.replaceChildren(errorBox(error));
    return;
  }

  const form = admin ? homeworkForm(ctx.refresh) : null;
  listBox.replaceChildren(
    items.length === 0
      ? message(showPast ? '지난 숙제가 없어요.' : '해야 할 숙제가 없어요. 🎉')
      : el(
          'ul',
          { class: 'list' },
          items.map((item) => homeworkItem(item, form, ctx.refresh)),
        ),
  );
  if (form) view.append(form.element);
}

export function fetchUpcomingHomework(limit) {
  let query = supabase
    .from('homework')
    .select('id, title, content, due_date')
    .gte('due_date', today())
    .order('due_date')
    .order('id');
  if (limit) query = query.limit(limit);
  return query;
}

function fetchPastHomework() {
  return supabase
    .from('homework')
    .select('id, title, content, due_date')
    .lt('due_date', today())
    .order('due_date', { ascending: false })
    .limit(50);
}

// 마감일 표시: D-3, 오늘 마감, 마감 지남
export function dueBadge(dueDate) {
  const days = daysUntil(dueDate);
  if (days < 0) return el('span', { class: 'badge' }, '마감 지남');
  if (days === 0) return el('span', { class: 'badge today' }, '오늘 마감');
  return el('span', { class: `badge ${days <= 2 ? 'soon' : 'later'}` }, `D-${days}`);
}

function homeworkItem(item, form, refresh) {
  const status = el('div');
  const li = el(
    'li',
    { class: daysUntil(item.due_date) < 0 ? 'past' : null },
    el(
      'div',
      { class: 'item-head' },
      dueBadge(item.due_date),
      el('span', { class: 'row-title' }, item.title),
      el('span', { class: 'row-meta' }, `마감 ${formatDate(item.due_date)}`),
    ),
    item.content ? el('p', { class: 'body-text' }, item.content) : null,
    status,
  );
  if (!form) return li;

  const deleteButton = el('button', { type: 'button', class: 'danger small' }, '삭제');
  deleteButton.addEventListener('click', () => {
    if (!confirm(`"${item.title}" 숙제를 삭제할까요?`)) return;
    withBusy(deleteButton, async () => {
      const { data, error } = await supabase.from('homework').delete().eq('id', item.id).select('id');
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
      el('button', { type: 'button', class: 'secondary small', onclick: () => form.edit(item) }, '수정'),
      deleteButton,
    ),
  );
  return li;
}

// 관리자용 입력 칸 (추가/수정 겸용)
function homeworkForm(refresh) {
  let editingId = null;

  const heading = el('h2', {}, '숙제 추가');
  const titleInput = el('input', { id: 'hw-title', maxlength: '50', required: true, placeholder: '예: 수학익힘 30~31쪽' });
  const dueInput = el('input', { id: 'hw-due', type: 'date', required: true });
  const contentInput = el('textarea', { id: 'hw-content', maxlength: '1000', placeholder: '자세한 설명 (선택)' });
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
      el('div', { style: 'flex-grow: 3' }, el('label', { for: 'hw-title' }, '숙제'), titleInput),
      el('div', {}, el('label', { for: 'hw-due' }, '마감일'), dueInput),
    ),
    el('label', { for: 'hw-content' }, '설명'),
    contentInput,
    status,
    el('div', { class: 'actions' }, submit, cancel),
  );

  function reset() {
    editingId = null;
    heading.textContent = '숙제 추가';
    submit.textContent = '추가';
    cancel.hidden = true;
    element.reset();
    status.replaceChildren();
  }

  cancel.addEventListener('click', reset);

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = {
      title: titleInput.value.trim(),
      due_date: dueInput.value,
      content: contentInput.value.trim() || null,
    };
    if (!values.title || !isDateStr(values.due_date)) {
      status.replaceChildren(message('숙제 이름과 마감일을 입력해 주세요.', 'error'));
      return;
    }
    withBusy(submit, async () => {
      const query = editingId
        ? supabase.from('homework').update(values).eq('id', editingId).select('id')
        : supabase.from('homework').insert(values).select('id');
      const { data, error } = await query;
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('저장할 권한이 없어요.', 'error'));
        return;
      }
      refresh();
    });
  });

  return {
    element,
    edit(item) {
      editingId = item.id;
      heading.textContent = '숙제 수정';
      submit.textContent = '수정 저장';
      cancel.hidden = false;
      titleInput.value = item.title;
      dueInput.value = item.due_date;
      contentInput.value = item.content ?? '';
      status.replaceChildren();
      element.scrollIntoView({ behavior: 'smooth' });
      titleInput.focus();
    },
  };
}
