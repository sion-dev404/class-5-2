import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '사이트';

// #/site : 관리자만. 학생에게 사이트 닫기/열기, 폐쇄 안내 문구, 학생 로그인 끊기
export async function render(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 볼 수 있는 화면이에요.', 'error'));
    return;
  }
  view.append(el('h1', {}, '사이트 열기 · 닫기'));
  const box = el('div', {}, loading());
  view.append(box);

  const { data: setting, error } = await supabase.from('site_settings').select('closed, notice, updated_at').eq('id', 1).maybeSingle();
  if (error || !setting) {
    box.replaceChildren(error ? errorBox(error) : message('설정을 찾지 못했어요. (선생님: schema.sql 실행 확인)', 'error'));
    return;
  }

  const status = el('div');
  const toggle = el('button', { type: 'button', class: setting.closed ? 'big' : 'big danger-solid' }, setting.closed ? '🔓 학생에게 다시 열기' : '🔒 학생에게 사이트 닫기');
  toggle.addEventListener('click', () => {
    const ask = setting.closed
      ? '학생에게 사이트를 다시 열까요? 도용된 계정의 비밀번호를 먼저 바꿨는지 확인해 주세요.'
      : '학생에게 사이트를 닫을까요? 학생은 "사이트 폐쇄" 화면만 보고, 어떤 자료도 볼 수 없어요.';
    if (!confirm(ask)) return;
    withBusy(toggle, async () => {
      const { error: e } = await supabase.from('site_settings').update({ closed: !setting.closed, updated_at: new Date().toISOString() }).eq('id', 1);
      if (e) return status.replaceChildren(errorBox(e));
      ctx.refresh();
    });
  });

  const noticeInput = el('textarea', { id: 'site-notice', maxlength: '300', rows: '3' }, setting.notice);
  const saveNotice = el('button', { type: 'button', class: 'secondary' }, '안내 문구 저장');
  saveNotice.addEventListener('click', () =>
    withBusy(saveNotice, async () => {
      const text = noticeInput.value.trim();
      if (!text) return status.replaceChildren(message('안내 문구를 써 주세요.', 'error'));
      const { error: e } = await supabase.from('site_settings').update({ notice: text, updated_at: new Date().toISOString() }).eq('id', 1);
      if (e) return status.replaceChildren(errorBox(e));
      status.replaceChildren(message('안내 문구를 저장했어요.', 'ok'));
    }),
  );

  const kick = el('button', { type: 'button', class: 'danger' }, '학생 로그인 모두 끊기');
  kick.addEventListener('click', () => {
    if (!confirm('모든 학생 계정의 로그인을 끊을까요? (선생님 계정은 그대로)')) return;
    withBusy(kick, async () => {
      const { data, error: e } = await supabase.rpc('sign_out_students');
      if (e) return status.replaceChildren(errorBox(e));
      status.replaceChildren(message(`학생 로그인 ${data}개를 끊었어요. 끊긴 학생은 다시 로그인해야 해요.`, 'ok'));
    });
  });

  box.replaceChildren(
    el(
      'section',
      { class: `card site-state ${setting.closed ? 'closed' : 'open'}` },
      el('h2', {}, setting.closed ? '🔒 지금: 학생에게 닫혀 있음' : '🟢 지금: 학생에게 열려 있음'),
      el('p', { class: 'row-meta' }, `마지막으로 바꾼 때: ${formatDateTime(setting.updated_at)}`),
      el('p', {}, setting.closed ? '학생과 로그인하지 않은 사람은 "사이트 폐쇄" 화면과 아래 안내 문구만 봐요. 선생님은 그대로 쓸 수 있어요.' : '닫으면 학생은 "사이트 폐쇄" 화면만 보고, DB도 학생의 모든 접근을 막아요.'),
      el('div', { class: 'actions' }, toggle),
    ),
    el('section', { class: 'card' }, el('label', { for: 'site-notice' }, '폐쇄 화면 안내 문구'), noticeInput, el('div', { class: 'actions' }, saveNotice)),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, '계정 도용 대응'),
      el('p', {}, '사이트를 닫은 뒤 학생 로그인을 끊으면, 도용한 사람이 로그인해 둔 상태여도 끊겨요.'),
      el('div', { class: 'actions' }, kick),
      el('p', { class: 'row-meta' }, '도용된 학생 계정은 Supabase → Authentication → Users 에서 비밀번호를 새로 바꿔 주세요. 선생님 계정 비밀번호도 바꾸는 걸 권해요.'),
    ),
    status,
  );
}
