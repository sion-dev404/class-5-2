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
    supabase.from('access_logs').select('user_id, ip, created_at').order('created_at', { ascending: false }).limit(1000),
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

  // ---------- 학생별 접속 기록 차트 (학생을 누르면 그 학생의 기록 100개) ----------
  const perUser = new Map();
  for (const log of logs ?? []) {
    const row = perUser.get(log.user_id);
    if (row) row.count += 1;
    else perUser.set(log.user_id, { count: 1, last: log.created_at, ip: log.ip });
  }
  const maxCount = Math.max(1, ...[...perUser.values()].map((row) => row.count));

  const logSection = el('section', { class: 'card' }, el('h2', {}, '학생별 접속 기록 (이름을 누르면 100개까지, 1년 지나면 자동 삭제)'));
  if (logsError) {
    logSection.append(errorBox(logsError));
  } else if (perUser.size === 0) {
    logSection.append(message('아직 접속 기록이 없어요.'));
  } else {
    logSection.append(
      el('p', { class: 'row-meta' }, '막대는 최근 1000번 접속 중 그 학생의 접속 횟수예요.'),
      el(
        'div',
        { class: 'visit-chart' },
        [...perUser].map(([userId, row]) => {
          const p = byId.get(userId);
          const label = p ? `${p.username}${saved.get(p.id) ? ` · ${saved.get(p.id)}` : ''}` : '(지운 계정)';
          const detail = el('div', { class: 'visit-detail', hidden: true });
          const head = el(
            'button',
            { type: 'button', class: 'visit-row', 'aria-expanded': 'false' },
            el('span', { class: 'visit-name' }, label),
            el('span', { class: 'visit-bar' }, el('span', { style: `width:${Math.round((row.count / maxCount) * 100)}%` })),
            el('span', { class: 'visit-count' }, `${row.count}번`),
            el('span', { class: 'row-meta visit-last' }, `${formatDateTime(row.last)} · ${row.ip ?? 'IP 없음'}`),
          );
          let loaded = false;
          head.addEventListener('click', async () => {
            const open = detail.hidden;
            detail.hidden = !open;
            head.setAttribute('aria-expanded', String(open));
            if (!open || loaded) return;
            detail.replaceChildren(loading());
            const { data, error: detailError } = await supabase
              .from('access_logs')
              .select('ip, user_agent, created_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(100);
            if (detailError) return detail.replaceChildren(errorBox(detailError));
            loaded = true;
            detail.replaceChildren(
              el(
                'div',
                { class: 'table-wrap' },
                el(
                  'table',
                  { class: 'rank-table log-table' },
                  el('thead', {}, el('tr', {}, el('th', {}, '시각'), el('th', {}, 'IP 주소'), el('th', {}, '브라우저'))),
                  el(
                    'tbody',
                    {},
                    data.map((log) =>
                      el('tr', {}, el('td', {}, formatDateTime(log.created_at)), el('td', {}, log.ip ?? '-'), el('td', { class: 'row-meta' }, (log.user_agent ?? '-').slice(0, 60))),
                    ),
                  ),
                ),
              ),
            );
          });
          return el('div', { class: 'visit-item' }, head, detail);
        }),
      ),
    );
  }

  // ---------- 신고된 1:1 메시지 (신고한 것만 보임) ----------
  const { data: reports, error: reportsError } = await supabase
    .from('message_reports')
    .select('id, reporter_id, sender_id, content, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  const reportSection = el('section', { class: 'card' }, el('h2', {}, `신고된 메시지 ${reports?.length ?? 0}건`));
  if (reportsError) {
    reportSection.append(reportsError.code === 'PGRST205' ? message('1:1 대화 SQL을 아직 실행하지 않았어요.') : errorBox(reportsError));
  } else if (reports.length === 0) {
    reportSection.append(message('신고된 메시지가 없어요.'));
  } else {
    const nameOf = (id) => {
      const p = byId.get(id);
      return p ? `${p.username}${saved.get(p.id) ? ` · ${saved.get(p.id)}` : ''}` : '(지운 계정)';
    };
    for (const report of reports) {
      const done = el('button', { type: 'button', class: 'secondary small' }, '확인 완료(삭제)');
      done.addEventListener('click', () =>
        withBusy(done, async () => {
          const { error: deleteError } = await supabase.from('message_reports').delete().eq('id', report.id);
          if (deleteError) return status.replaceChildren(errorBox(deleteError));
          item.remove();
        }),
      );
      const item = el(
        'div',
        { class: 'card' },
        el('p', {}, `신고한 사람: ${nameOf(report.reporter_id)} → 신고당한 사람: ${nameOf(report.sender_id)}`),
        el('p', { class: 'row-meta' }, formatDateTime(report.created_at)),
        el('pre', { class: 'report-text' }, report.content),
        done,
      );
      reportSection.append(item);
    }
  }

  box.replaceChildren(requests, reportSection, status, members, logSection);
}
