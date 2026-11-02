import { isAdmin } from '../auth.js';
import { el, formatDate, message, today } from '../ui.js';

export const title = '홈';

// 소통 공간(게시판·보드·갤러리)으로 가는 바로가기
const SHORTCUTS = [
  ['#/board', '📝', '게시판', '글을 쓰고 댓글로 이야기해요.'],
  ['#/topics', '💬', '보드', '주제마다 생각을 나눠요.'],
  ['#/gallery', '🖼️', '갤러리', '사진을 모아 봐요.'],
];

export function render(view, ctx) {
  const name = isAdmin(ctx.user) ? '선생님' : `${ctx.user.nickname ?? ctx.user.username}님`;

  view.append(
    el('h1', {}, `안녕하세요, ${name}!`),
    el('p', { class: 'muted' }, `오늘은 ${formatDate(today())}이에요.`),
  );
  if (ctx.user.profileMissing) {
    view.append(message('계정 정보(profiles)를 찾지 못했어요. 선생님께 알려 주세요.', 'warn'));
  } else if (!ctx.user.nickname) {
    view.append(
      el(
        'p',
        { class: 'ok' },
        '아직 별명이 없어요. 게시판에 아이디 대신 별명이 보이게 할 수 있어요. ',
        el('a', { href: '#/me' }, '✏️ 별명 정하기'),
      ),
    );
  }
  view.append(
    el(
      'div',
      { class: 'shortcut-grid' },
      SHORTCUTS.map(([href, icon, label, text]) =>
        el(
          'a',
          { class: 'card shortcut', href },
          el('span', { class: 'shortcut-icon', 'aria-hidden': 'true' }, icon),
          el('strong', {}, label),
          el('span', { class: 'muted' }, text),
        ),
      ),
    ),
  );
}
