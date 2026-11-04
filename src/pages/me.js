import { supabase } from '../supabase.js';
import { forgetUser, isAdmin } from '../auth.js';
import { el, errorBox, message, withBusy } from '../ui.js';
import { isApp } from '../native.js';
import { canUseWebPush, enableWebPush, webPushPermission } from '../webpush.js';

export const title = '내 정보';

export async function render(view, ctx) {
  const { user } = ctx;
  const input = el('input', {
    id: 'nickname',
    maxlength: '10',
    value: user.nickname ?? '',
    placeholder: '비워 두면 아이디가 보여요',
  });
  const status = el('div');
  const button = el('button', { type: 'submit' }, '저장');

  const form = el(
    'form',
    { class: 'card' },
    el('label', { for: 'nickname' }, '별명 (10자 이내) — 게시판에 아이디 대신 보여요'),
    input,
    message('⚠️ 진짜 이름은 쓰지 않아요. 친구들이 알아볼 수 있는 재미있는 별명을 정해 보세요.', 'warn'),
    status,
    button,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(button, async () => {
      const nickname = input.value.trim() || null;
      const { data, error } = await supabase
        .from('profiles')
        .update({ nickname })
        .eq('id', user.id)
        .select('id');
      if (error || data.length === 0) {
        status.replaceChildren(error ? errorBox(error) : message('저장하지 못했어요.', 'error'));
        return;
      }
      forgetUser();
      ctx.refresh();
    });
  });

  view.append(
    el('h1', {}, '내 정보 · 별명'),
    el(
      'dl',
      { class: 'card info' },
      el('dt', {}, '아이디'),
      el('dd', {}, user.username),
      el('dt', {}, '역할'),
      el('dd', {}, isAdmin(user) ? '관리자(선생님)' : '학생'),
    ),
    user.profileMissing
      ? message('profiles 정보가 없어 별명을 저장할 수 없어요. (선생님: schema.sql 실행 확인)', 'error')
      : form,
    await notifySection(),
  );
}

// 브라우저(크롬·사파리 홈 화면 앱)에서 알림 켜기. 앱(APK)은 자동이라 이 칸이 없음
async function notifySection() {
  if (isApp() || !(await canUseWebPush())) return null;
  const status = el('div');
  const button = el('button', { type: 'button' }, webPushPermission() === 'granted' ? '이 기기 알림 다시 켜기' : '알림 켜기');
  button.addEventListener('click', () =>
    withBusy(button, async () => {
      const result = await enableWebPush();
      status.replaceChildren(result.ok ? message('알림을 켰어요! 댓글·공감·메시지가 오면 알려 줘요.', 'ok') : message(result.error, 'error'));
    }),
  );
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, '알림'),
    el('p', { class: 'row-meta' }, '댓글, 공감, 1:1 메시지가 오면 폰에 알려 줘요. 아이폰은 사파리에서 "홈 화면에 추가"한 앱에서만 켤 수 있어요.'),
    status,
    button,
  );
}
