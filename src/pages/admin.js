import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { forgetRealNames } from '../realnames.js';
import { el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '학생 관리';

// #/admin : 관리자만. 가입 요청 승인·거절, 학생 실명, 계정 삭제, 접속 기록
export async function render(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 볼 수 있는 화면이에요.', 'error'));
    return;
  }

  view.append(
    el('h1', {}, '학생 관리'),
    message('🔒 실명과 접속 기록은 선생님(관리자)에게만 보여요. 학생들은 친구 실명을 볼 수 없어요.', 'ok'),
  );
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: profiles, error }, { data: names, error: namesError }, { data: logs, error: logsError }] = await Promise.all([
    supabase.from('profiles').select('id, username, nickname, role, status, privacy_agreed_at, privacy_version, created_at').order('username'),
    supabase.from('student_names').select('user_id, real_name, email'),
    supabase.from('access_logs').select('user_id, user_agent, created_at').order('created_at', { ascending: false }).limit(500),
  ]);
  if (error || namesError) {
    box.replaceChildren(errorBox(error ?? namesError));
    return;
  }

  const saved = new Map(names.map((row) => [row.user_id, row.real_name]));
  const emails = new Map(names.filter((row) => row.email).map((row) => [row.user_id, row.email]));
  const pending = profiles.filter((p) => p.role === 'student' && p.status === 'pending');
  const students = profiles.filter((p) => p.role === 'student' && p.status !== 'pending');
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const status = el('div');

  const call = (button, fn, args, ask) => {
    if (ask && !confirm(ask)) return;
    withBusy(button, async () => {
      const { error: e } = await supabase.rpc(fn, args);
      if (e) return status.replaceChildren(errorBox(e));
      forgetRealNames();
      ctx.refresh();
    });
  };

  // ---------- 가입 요청 ----------
  const requests = el(
    'section',
    { class: 'card requests' },
    el('h2', {}, `가입 요청 ${pending.length}건`),
    pending.length
      ? el(
          'ul',
          { class: 'list compact' },
          pending.map((p) => {
            const consented = !!p.privacy_agreed_at;
            const approve = el('button', { type: 'button', class: 'small', disabled: !consented, title: consented ? null : '아직 동의·가입 요청 전이라 승인할 수 없어요' }, consented ? '승인' : '동의 전');
            const reject = el('button', { type: 'button', class: 'danger small' }, '거절(삭제)');
            approve.addEventListener('click', () => call(approve, 'set_member_status', { p_user_id: p.id, p_status: 'approved' }));
            reject.addEventListener('click', () => call(reject, 'remove_member', { p_user_id: p.id }, `${p.username} 가입 요청을 거절하고 계정을 지울까요?`));
            return el(
              'li',
              { class: 'item-head' },
              el('strong', {}, p.username),
              el('span', {}, saved.get(p.id) ?? '(이름 없음)'),
              emails.has(p.id) ? el('span', { class: 'badge later', title: 'Google 계정' }, `✉️ ${emails.get(p.id)}`) : null,
              el('span', { class: 'row-meta' }, `요청 ${formatDateTime(p.created_at)} · 동의 ${p.privacy_agreed_at ? `${formatDateTime(p.privacy_agreed_at)} (${p.privacy_version ?? '-'})` : '기록 없음'}`),
              el('span', { class: 'spacer' }),
              approve,
              reject,
            );
          }),
        )
      : message('새 가입 요청이 없어요.'),
  );

  // ---------- 학생 (실명, 삭제) ----------
  const inputs = new Map();
  const list = el(
    'ul',
    { class: 'list' },
    students.map((p) => {
      const input = el('input', { id: `name-${p.username}`, maxlength: '20', value: saved.get(p.id) ?? '', placeholder: '실명', autocomplete: 'off' });
      inputs.set(p.id, input);
      const remove = el('button', { type: 'button', class: 'danger small' }, '계정 삭제');
      remove.addEventListener('click', () =>
        call(remove, 'remove_member', { p_user_id: p.id }, `${p.username} 계정을 지울까요? 그 학생이 쓴 글·댓글·기록도 모두 지워지고, 되돌릴 수 없어요.`),
      );
      return el(
        'li',
        { class: 'name-row' },
        el('label', { for: `name-${p.username}` }, el('strong', {}, p.username), p.nickname ? el('span', { class: 'row-meta' }, ` (${p.nickname})`) : null),
        input,
        remove,
      );
    }),
  );

  const saveButton = el('button', { type: 'button' }, '실명 모두 저장');
  saveButton.addEventListener('click', () =>
    withBusy(saveButton, async () => {
      const upserts = [];
      const deletes = [];
      for (const [id, input] of inputs) {
        const value = input.value.trim();
        if (value && value !== saved.get(id)) upserts.push({ user_id: id, real_name: value, updated_at: new Date().toISOString() });
        if (!value && saved.has(id)) deletes.push(id);
      }
      if (upserts.length === 0 && deletes.length === 0) {
        status.replaceChildren(message('바뀐 내용이 없어요.'));
        return;
      }
      if (upserts.length) {
        const { error: upsertError } = await supabase.from('student_names').upsert(upserts, { onConflict: 'user_id' });
        if (upsertError) return status.replaceChildren(errorBox(upsertError));
      }
      if (deletes.length) {
        const { error: deleteError } = await supabase.from('student_names').delete().in('user_id', deletes);
        if (deleteError) return status.replaceChildren(errorBox(deleteError));
      }
      upserts.forEach((row) => saved.set(row.user_id, row.real_name));
      deletes.forEach((id) => saved.delete(id));
      forgetRealNames();
      status.replaceChildren(message(`저장했어요. (${upserts.length}명 저장, ${deletes.length}명 지움)`, 'ok'));
    }),
  );

  const members = el(
    'section',
    { class: 'card' },
    el('h2', {}, `학생 ${students.length}명`),
    students.length === 0 ? message('승인된 학생 계정이 없어요.') : list,
    students.length ? el('div', { class: 'actions' }, saveButton) : null,
  );

  // ---------- 접속 기록 (IP 없이, 계정별로 묶어서) ----------
  const perUser = new Map();
  for (const log of logs ?? []) {
    const row = perUser.get(log.user_id) ?? { count: 0, last: log.created_at, agent: log.user_agent };
    row.count += 1;
    perUser.set(log.user_id, row);
  }
  const logSection = el(
    'section',
    { class: 'card' },
    el('h2', {}, '계정별 접속 기록 (최근 500번 기준, 1년 지나면 자동 삭제)'),
    logsError
      ? errorBox(logsError)
      : perUser.size
        ? el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'rank-table log-table' },
              el('thead', {}, el('tr', {}, el('th', {}, '아이디'), el('th', {}, '마지막 접속'), el('th', {}, '접속 횟수'), el('th', {}, '기기'))),
              el(
                'tbody',
                {},
                [...perUser].map(([userId, row]) => {
                  const p = byId.get(userId);
                  return el(
                    'tr',
                    {},
                    el('td', {}, p ? `${p.username}${saved.get(p.id) ? ` · ${saved.get(p.id)}` : ''}` : '(지운 계정)'),
                    el('td', {}, formatDateTime(row.last)),
                    el('td', {}, `${row.count}번`),
                    el('td', { class: 'row-meta' }, (row.agent ?? '-').slice(0, 60)),
                  );
                }),
              ),
            ),
          )
        : message('아직 접속 기록이 없어요.'),
  );

  box.replaceChildren(requests, status, members, logSection);
}
