import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster, participationPanel } from '../roster.js';
import { dateNav, displayName, el, errorBox, formatDate, isDateStr, loading, message, today, withBusy } from '../ui.js';

export const title = '1인1역';

// #/jobs                → 오늘 현황
// #/jobs?date=2026-10-01 → 그날 현황 (지난 기록 보기)
export async function render(view, ctx) {
  const admin = isAdmin(ctx.user);
  const date = isDateStr(ctx.query.get('date')) ? ctx.query.get('date') : today();
  const isToday = date === today();

  view.append(el('h1', {}, '1인1역'), dateNav('/jobs', date));
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: jobs, error }, { data: assignments, error: aError }, { data: checks, error: cError }, { data: roster }, names] = await Promise.all([
    supabase.from('jobs').select('id, name, description').order('id'),
    supabase.from('job_assignments').select('user_id, job_id'),
    supabase.from('job_checks').select('user_id').eq('check_date', date),
    fetchRoster(),
    realNames(ctx.user),
  ]);
  if (error || aError || cError) {
    box.replaceChildren(errorBox(error ?? aError ?? cError));
    return;
  }
  const students = roster ?? [];
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const jobOf = new Map(assignments.map((a) => [a.user_id, jobById.get(a.job_id)]));
  const checked = new Set(checks.map((c) => c.user_id));
  const parts = [];

  // 내 역할 (학생)
  if (!admin) {
    const myJob = jobOf.get(ctx.user.id);
    const status = el('div');
    let action = null;
    if (myJob && isToday) {
      const done = checked.has(ctx.user.id);
      action = el('button', { type: 'button', class: done ? 'secondary' : '' }, done ? '체크 취소' : '오늘 했어요 ✅');
      action.addEventListener('click', () =>
        withBusy(action, async () => {
          const { error: e } = done
            ? await supabase.from('job_checks').delete().eq('user_id', ctx.user.id).eq('check_date', date)
            : await supabase.from('job_checks').insert({ user_id: ctx.user.id });
          if (e) return status.replaceChildren(errorBox(e));
          ctx.refresh();
        }),
      );
    }
    parts.push(
      el(
        'section',
        { class: 'card my-job' },
        el('h2', {}, myJob ? `내 역할: ${myJob.name}` : '아직 내 역할이 없어요'),
        myJob?.description ? el('p', { class: 'body-text' }, myJob.description) : null,
        myJob && !isToday ? el('p', { class: 'row-meta' }, checked.has(ctx.user.id) ? '이 날 했어요 ✅' : '이 날은 체크하지 않았어요') : null,
        action,
        status,
      ),
    );
  }

  // 현황: 그날 체크한 학생 (칩에 역할 이름)
  const done = new Map(students.filter((s) => checked.has(s.id)).map((s) => [s.id, jobOf.get(s.id)?.name ?? '']));
  parts.push(participationPanel(students, done, names, `${isToday ? '오늘' : formatDate(date)} 1인1역 현황`));

  // 역할별 담당 학생
  parts.push(
    el(
      'section',
      { class: 'card' },
      el('h2', {}, '역할과 담당'),
      jobs.length === 0
        ? message(admin ? '아직 역할이 없어요. 아래에서 만들어 주세요.' : '아직 역할이 없어요.')
        : el(
            'ul',
            { class: 'list compact' },
            jobs.map((job) => {
              const members = students.filter((s) => jobOf.get(s.id)?.id === job.id);
              return el(
                'li',
                {},
                el('div', { class: 'row-title' }, job.name),
                job.description ? el('div', { class: 'row-meta' }, job.description) : null,
                el(
                  'div',
                  {},
                  members.length
                    ? members.map((s) => el('span', { class: `chip ${checked.has(s.id) ? 'done' : 'todo'}` }, `${checked.has(s.id) ? '✅' : '⬜'} ${withRealName(displayName(s), s.id, names)}`))
                    : el('span', { class: 'row-meta' }, '담당 없음'),
                ),
              );
            }),
          ),
    ),
  );

  if (admin) parts.push(...adminTools(ctx, jobs, students, jobOf, checked, names, date));
  box.replaceChildren(...parts);
}

function adminTools(ctx, jobs, students, jobOf, checked, names, date) {
  // 역할 만들기·지우기
  const nameInput = el('input', { id: 'job-name', maxlength: '30', placeholder: '예: 칠판 지우기' });
  const descInput = el('input', { id: 'job-desc', maxlength: '200', placeholder: '하는 일 (선택)' });
  const jobStatus = el('div');
  const add = el('button', { type: 'submit' }, '역할 추가');
  const jobForm = el(
    'form',
    { class: 'card' },
    el('h2', {}, '역할 관리'),
    el('div', { class: 'field-row' }, el('div', {}, el('label', { for: 'job-name' }, '역할'), nameInput), el('div', {}, el('label', { for: 'job-desc' }, '하는 일'), descInput)),
    el('div', { class: 'actions' }, add),
    jobs.length
      ? el(
          'ul',
          { class: 'list compact' },
          jobs.map((job) => {
            const remove = el('button', { type: 'button', class: 'danger small' }, '삭제');
            remove.addEventListener('click', () => {
              if (!confirm(`"${job.name}" 역할을 삭제할까요? 이 역할을 맡은 학생의 배정도 지워져요.`)) return;
              withBusy(remove, async () => {
                const { error } = await supabase.from('jobs').delete().eq('id', job.id);
                if (error) return jobStatus.replaceChildren(errorBox(error));
                ctx.refresh();
              });
            });
            return el('li', { class: 'item-head' }, el('span', {}, job.name), el('span', { class: 'spacer' }), remove);
          }),
        )
      : null,
    jobStatus,
  );
  jobForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return jobStatus.replaceChildren(message('역할 이름을 써 주세요.', 'error'));
    withBusy(add, async () => {
      const { error } = await supabase.from('jobs').insert({ name, description: descInput.value.trim() || null });
      if (error) return jobStatus.replaceChildren(errorBox(error));
      ctx.refresh();
    });
  });

  // 학생별 역할 정하기 + 체크 대신 해 주기
  const selects = new Map();
  const assignStatus = el('div');
  const rows = students.map((s) => {
    const select = el(
      'select',
      { id: `job-of-${s.username}` },
      el('option', { value: '' }, '(역할 없음)'),
      jobs.map((job) => el('option', { value: String(job.id) }, job.name)),
    );
    select.value = jobOf.get(s.id) ? String(jobOf.get(s.id).id) : '';
    selects.set(s.id, select);
    const isChecked = checked.has(s.id);
    const toggle = el('button', { type: 'button', class: 'secondary small' }, isChecked ? '체크 취소' : '했어요 체크');
    toggle.addEventListener('click', () =>
      withBusy(toggle, async () => {
        const { error } = isChecked
          ? await supabase.from('job_checks').delete().eq('user_id', s.id).eq('check_date', date)
          : await supabase.from('job_checks').insert({ user_id: s.id, check_date: date });
        if (error) return assignStatus.replaceChildren(errorBox(error));
        ctx.refresh();
      }),
    );
    return el(
      'li',
      { class: 'name-row' },
      el('label', { for: `job-of-${s.username}` }, `${isChecked ? '✅' : '⬜'} ${withRealName(displayName(s), s.id, names)}`),
      select,
      toggle,
    );
  });
  const save = el('button', { type: 'button' }, '역할 배정 저장');
  save.addEventListener('click', () =>
    withBusy(save, async () => {
      const upserts = [];
      const removes = [];
      for (const [userId, select] of selects) {
        const current = jobOf.get(userId)?.id ?? null;
        const next = select.value ? Number(select.value) : null;
        if (next === current) continue;
        if (next) upserts.push({ user_id: userId, job_id: next, updated_at: new Date().toISOString() });
        else removes.push(userId);
      }
      if (!upserts.length && !removes.length) return assignStatus.replaceChildren(message('바뀐 내용이 없어요.'));
      if (upserts.length) {
        const { error } = await supabase.from('job_assignments').upsert(upserts, { onConflict: 'user_id' });
        if (error) return assignStatus.replaceChildren(errorBox(error));
      }
      if (removes.length) {
        const { error } = await supabase.from('job_assignments').delete().in('user_id', removes);
        if (error) return assignStatus.replaceChildren(errorBox(error));
      }
      ctx.refresh();
    }),
  );

  const assignCard = el(
    'section',
    { class: 'card' },
    el('h2', {}, `학생별 역할 정하기 (${formatDate(date)} 체크)`),
    jobs.length ? el('ul', { class: 'list compact' }, rows) : message('역할을 먼저 만들어 주세요.'),
    assignStatus,
    jobs.length ? el('div', { class: 'actions' }, save) : null,
  );

  return [assignCard, jobForm];
}
