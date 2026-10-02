import { supabase } from './supabase.js';
import { isAdmin } from './auth.js';
import { el, errorBox, formatDate, isDateStr, message, toDateStr, today, withBusy } from './ui.js';

// 홈 캘린더: 학급 일정(선생님 입력) + 숙제 마감일
// 달 이동·날짜 고르기는 이 칸 안에서만 다시 그림
export function calendarSection(ctx) {
  const admin = isAdmin(ctx.user);
  const box = el('section', { class: 'card calendar' });
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0~11
  let selected = today();

  async function draw() {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const from = toDateStr(first);
    const to = toDateStr(last);

    const [{ data: events, error }, { data: homework, error: hError }] = await Promise.all([
      supabase.from('events').select('id, event_date, title').gte('event_date', from).lte('event_date', to).order('event_date').order('id'),
      supabase.from('homework').select('id, title, due_date').gte('due_date', from).lte('due_date', to).order('due_date'),
    ]);

    const head = el(
      'div',
      { class: 'cal-head' },
      el('button', { type: 'button', class: 'secondary small', 'aria-label': '지난달', onclick: () => move(-1) }, '◀'),
      el('h2', {}, `${year}년 ${month + 1}월`),
      el('button', { type: 'button', class: 'secondary small', 'aria-label': '다음달', onclick: () => move(1) }, '▶'),
    );
    if (error || hError) {
      // 일정 표가 아직 없으면(SQL 실행 전) 숙제만이라도
      if (error?.code !== 'PGRST205') return box.replaceChildren(head, errorBox(error ?? hError));
    }
    const eventList = error ? [] : events;
    const homeworkList = hError ? [] : homework;

    const byDate = new Map();
    const add = (date, item) => byDate.set(date, [...(byDate.get(date) ?? []), item]);
    eventList.forEach((e) => add(e.event_date, { kind: 'event', ...e }));
    homeworkList.forEach((h) => add(h.due_date, { kind: 'homework', ...h }));

    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(el('div', { class: 'cal-cell empty' }));
    for (let d = 1; d <= last.getDate(); d++) {
      const date = toDateStr(new Date(year, month, d));
      const items = byDate.get(date) ?? [];
      const weekday = new Date(year, month, d).getDay();
      cells.push(
        el(
          'button',
          {
            type: 'button',
            class: ['cal-cell', date === today() ? 'today' : '', date === selected ? 'selected' : '', weekday === 0 ? 'sun' : '', weekday === 6 ? 'sat' : ''].join(' '),
            'aria-label': `${formatDate(date)}${items.length ? `, 일정 ${items.length}개` : ''}`,
            onclick: () => {
              selected = date;
              draw();
            },
          },
          el('span', { class: 'cal-day' }, String(d)),
          el(
            'span',
            { class: 'cal-dots' },
            items.some((i) => i.kind === 'event') ? el('span', { class: 'dot event' }) : null,
            items.some((i) => i.kind === 'homework') ? el('span', { class: 'dot homework' }) : null,
          ),
          items.length ? el('span', { class: 'cal-label' }, items[0].title) : null,
        ),
      );
    }

    const weekdays = el('div', { class: 'cal-grid cal-weekdays' }, ['일', '월', '화', '수', '목', '금', '토'].map((w) => el('div', {}, w)));
    const grid = el('div', { class: 'cal-grid' }, cells);

    // 고른 날의 일정
    const dayItems = byDate.get(selected) ?? [];
    const status = el('div');
    const dayList = el(
      'div',
      { class: 'cal-day-list' },
      el('h3', {}, formatDate(selected)),
      dayItems.length
        ? el(
            'ul',
            { class: 'list compact' },
            dayItems.map((item) => {
              let remove = null;
              if (admin && item.kind === 'event') {
                remove = el('button', { type: 'button', class: 'danger small' }, '삭제');
                remove.addEventListener('click', () => {
                  if (!confirm(`"${item.title}" 일정을 삭제할까요?`)) return;
                  withBusy(remove, async () => {
                    const { error: e } = await supabase.from('events').delete().eq('id', item.id);
                    if (e) return status.replaceChildren(errorBox(e));
                    draw();
                  });
                });
              }
              return el(
                'li',
                { class: 'item-head' },
                el('span', { class: `dot ${item.kind}` }),
                item.kind === 'homework' ? el('a', { href: '#/homework' }, `숙제 마감: ${item.title}`) : el('span', {}, item.title),
                el('span', { class: 'spacer' }),
                remove,
              );
            }),
          )
        : message('일정이 없어요.'),
      status,
    );

    let form = null;
    if (admin && !error) {
      const dateInput = el('input', { type: 'date', value: selected, 'aria-label': '일정 날짜' });
      const titleInput = el('input', { maxlength: '50', placeholder: '일정 (예: 현장체험학습)', 'aria-label': '일정 내용' });
      const submit = el('button', { type: 'submit', class: 'small' }, '일정 추가');
      form = el('form', { class: 'cal-form' }, dateInput, titleInput, submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const title = titleInput.value.trim();
        if (!title || !isDateStr(dateInput.value)) return status.replaceChildren(message('날짜와 일정을 써 주세요.', 'error'));
        withBusy(submit, async () => {
          const { error: e } = await supabase.from('events').insert({ event_date: dateInput.value, title });
          if (e) return status.replaceChildren(errorBox(e));
          selected = dateInput.value;
          const picked = new Date(`${selected}T00:00:00`);
          year = picked.getFullYear();
          month = picked.getMonth();
          draw();
        });
      });
    }

    box.replaceChildren(
      head,
      weekdays,
      grid,
      el('div', { class: 'cal-legend row-meta' }, el('span', { class: 'dot event' }), ' 학급 일정  ', el('span', { class: 'dot homework' }), ' 숙제 마감'),
      dayList,
      form ?? '',
    );
  }

  function move(delta) {
    const d = new Date(year, month + delta, 1);
    year = d.getFullYear();
    month = d.getMonth();
    selected = toDateStr(d);
    draw();
  }

  box.append(message('달력을 불러오는 중…'));
  draw();
  return box;
}
