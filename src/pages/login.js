import { signIn } from '../auth.js';
import { CLASS_NAME } from '../config.js';
import { el, message, withBusy } from '../ui.js';

export const title = '로그인';

export function render(view, ctx) {
  const idInput = el('input', {
    id: 'login-id',
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: 'false',
    required: true,
    placeholder: '예: s01',
  });
  const pwInput = el('input', {
    id: 'login-pw',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
  });
  const status = el('div');
  const button = el('button', { type: 'submit' }, '로그인');

  const form = el(
    'form',
    { class: 'card login' },
    el('h1', {}, `${CLASS_NAME} 로그인`),
    el('label', { for: 'login-id' }, '아이디'),
    idInput,
    el('label', { for: 'login-pw' }, '비밀번호'),
    pwInput,
    status,
    button,
    message('🔒 학교나 공용 컴퓨터에서는 다 쓰고 꼭 로그아웃하세요.', 'warn'),
    message('비밀번호를 잊었으면 선생님께 말씀해 주세요.'),
    el(
      'p',
      { class: 'login-links' },
      ctx.adminOnly ? null : el('a', { href: '#/signup' }, '처음이에요? 회원가입'),
      ctx.adminOnly ? null : ' · ',
      el('a', { href: '#/privacy' }, '개인정보 처리방침'),
    ),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(button, async () => {
      status.replaceChildren(message('로그인하는 중…'));
      const { error } = await signIn(idInput.value, pwInput.value);
      if (error) {
        status.replaceChildren(message(error.message, 'error'));
        pwInput.value = '';
        pwInput.focus();
        return;
      }
      ctx.afterLogin();
    });
  });

  view.append(form);
  idInput.focus();
}
