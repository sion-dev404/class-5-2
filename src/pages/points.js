import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster } from '../roster.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '점수';

// #/points : 관리자만. 칭찬·활동 점수 주기와 순위 (학생은 볼 수 없음)
export async function render(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 볼 수 있는 화면이에요.', 'error'));
    return;
  }
  view.append(el('h1', {}, '점수 랭킹'), message('🔒 점수는 선생님(관리자)에게만 보여요. 학생은 자기 점수도 볼 수 없어요.', 'ok'));
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: rows, error }, { data: attempts, error: aError }, { data: roster }, names] = await Promise.all([
    supabase.from('points').select('id, user_id, points, reason, created_at').order('created_at', { ascending: false }),
    supabase.from('quiz_attempts').select('user_id, score'),
    fetchRoster(),
    realNames(ctx.user),
  ]);
  if (error) {
    box.replaceChildren(errorBox(error));
    return;
  }
  const students = roster ?? [];
  const label = (s) => withRealName(displayName(s), s.id, names);

  // 합계와 순위 (같은 점수는 같은 등수)
  const totals = new Map(students.map((s) => [s.id, 0]));
  rows.forEach((r) => totals.has(r.user_id) && totals.set(r.user_id, totals.get(r.user_id) + r.points));
  const quizTotals = new Map();
  (aError ? [] : attempts).forEach((a) => quizTotals.set(a.user_id, (quizTotals.get(a.user_id) ?? 0) + a.score));
  const ranked = [...students].sort((a, b) => totals.get(b.id) - totals.get(a.id) || a.username.localeCompare(b.username));
  let rank = 0;
  let prev = null;
  const ranking = el(
    'section',
    { class: 'card' },
    el('h2', {}, '순위'),
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'rank-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '순위'), el('th', {}, '학생'), el('th', { class: 'num' }, '점수'), el('th', { class: 'num' }, '퀴즈 맞힌 수'))),
        el(
          'tbody',
          {},
          ranked.map((s, i) => {
            const total = totals.get(s.id);
            if (total !== prev) rank = i + 1;
            prev = total;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            return el('tr', {}, el('td', {}, `${medal}${rank}`), el('td', {}, label(s)), el('td', { class: 'num' }, String(total)), el('td', { class: 'num' }, String(quizTotals.get(s.id) ?? 0)));
          }),
        ),
      ),
    ),
  );

  // 점수 주기: 여러 학생을 골라 한 번에
  const checks = new Map();
  const pointsInput = el('input', { id: 'points-value', type: 'number', min: '-100', max: '100', step: '1', value: '1', 'aria-label': '점수' });
  const reasonInput = el('input', { id: 'points-reason', maxlength: '100', placeholder: '이유 (예: 발표, 청소, 도움)' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '점수 주기');
  const form = el(
    'form',
    { class: 'card' },
    el('h2', {}, '점수 주기'),
    el(
      'div',
      { class: 'student-picks' },
      students.map((s) => {
        const box = el('input', { type: 'checkbox', value: s.id });
        checks.set(s.id, box);
        return el('label', { class: 'pick' }, box, ` ${label(s)}`);
      }),
    ),
    el(
      'div',
      { class: 'actions' },
      el('button', { type: 'button', class: 'secondary small', onclick: () => checks.forEach((c) => (c.checked = true)) }, '모두 선택'),
      el('button', { type: 'button', class: 'secondary small', onclick: () => checks.forEach((c) => (c.checked = false)) }, '선택 해제'),
    ),
    el('div', { class: 'field-row' }, el('div', {}, el('label', { for: 'points-value' }, '점수 (빼려면 -)'), pointsInput), el('div', { style: 'flex-grow: 3' }, el('label', { for: 'points-reason' }, '이유'), reasonInput)),
    status,
    el('div', { class: 'actions' }, submit),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const picked = [...checks].filter(([, c]) => c.checked).map(([id]) => id);
    const value = Number.parseInt(pointsInput.value, 10);
    if (!picked.length) return status.replaceChildren(message('학생을 골라 주세요.', 'error'));
    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 100) return status.replaceChildren(message('점수는 -100 ~ 100 사이 (0 제외)로 써 주세요.', 'error'));
    withBusy(submit, async () => {
      const reason = reasonInput.value.trim() || null;
      const { error: e } = await supabase.from('points').insert(picked.map((id) => ({ user_id: id, points: value, reason })));
      if (e) return status.replaceChildren(errorBox(e));
      ctx.refresh();
    });
  });

  // 최근 기록 (지우기 가능)
  const byId = new Map(students.map((s) => [s.id, s]));
  const historyStatus = el('div');
  const history = el(
    'section',
    { class: 'card' },
    el('h2', {}, '최근 기록'),
    rows.length
      ? el(
          'ul',
          { class: 'list compact' },
          rows.slice(0, 50).map((r) => {
            const remove = el('button', { type: 'button', class: 'danger small' }, '취소');
            remove.addEventListener('click', () => {
              if (!confirm('이 점수 기록을 취소할까요?')) return;
              withBusy(remove, async () => {
                const { error: e } = await supabase.from('points').delete().eq('id', r.id);
                if (e) return historyStatus.replaceChildren(errorBox(e));
                ctx.refresh();
              });
            });
            const s = byId.get(r.user_id);
            return el(
              'li',
              { class: 'item-head' },
              el('strong', {}, s ? label(s) : '(지운 계정)'),
              el('span', { class: `badge ${r.points > 0 ? 'later' : 'today'}` }, `${r.points > 0 ? '+' : ''}${r.points}`),
              r.reason ? el('span', {}, r.reason) : null,
              el('span', { class: 'row-meta' }, formatDateTime(r.created_at)),
              el('span', { class: 'spacer' }),
              remove,
            );
          }),
        )
      : message('아직 점수 기록이 없어요.'),
    historyStatus,
  );

  box.replaceChildren(ranking, form, history);
}
