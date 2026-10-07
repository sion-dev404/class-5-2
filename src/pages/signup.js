import { signUp } from '../auth.js';
import { CONSENTS } from '../privacy.js';
import { el, message, withBusy } from '../ui.js';

export const title = '회원가입';

// 동의 문서 하나 (제목 + 항목들)
export function consentDocument(consent) {
  return el(
    'div',
    { class: 'consent-doc' },
    consent.sections.map(([heading, lines]) => el('div', { class: 'consent-section' }, el('h3', {}, heading), el('ul', {}, lines.map((line) => el('li', {}, line))))),
  );
}

// #/signup : ① 두 가지 동의 → ② 가입 요청 (선생님 승인 후 사용)
//   ctx.preview = true 이면 선생님 미리보기 (요청을 보내지 않음)
export function render(view, ctx) {
  const checks = CONSENTS.map((consent) => {
    const box = el('input', { type: 'checkbox', id: `agree-${consent.id}` });
    return { consent, box };
  });
  const allBox = el('input', { type: 'checkbox', id: 'agree-all' });
  const next = el('button', { type: 'button', disabled: true }, '다음');
  const update = () => {
    const ok = checks.every((c) => c.box.checked);
    next.disabled = !ok;
    allBox.checked = ok;
  };
  checks.forEach((c) => c.box.addEventListener('change', update));
  allBox.addEventListener('change', () => {
    checks.forEach((c) => (c.box.checked = allBox.checked));
    update();
  });

  const step1 = el(
    'section',
    { class: 'signup-step' },
    el('h1', {}, '회원가입 (1/2) · 동의하기'),
    message('누리집을 쓰려면 아래 두 가지에 모두 동의해야 해요. 천천히 읽어 보세요.'),
    checks.map(({ consent, box }) =>
      el(
        'section',
        { class: 'card consent' },
        el('h2', {}, consent.title),
        consentDocument(consent),
        el('label', { class: 'agree', for: box.id }, box, ' 위 내용을 읽었고 동의합니다'),
      ),
    ),
    el('label', { class: 'agree all', for: 'agree-all' }, allBox, ' 모두 동의합니다'),
    el('div', { class: 'actions' }, next, el('a', { href: '#/login', class: 'muted' }, '취소')),
  );

  // ② 가입 정보
  const idInput = el('input', { id: 'su-id', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '30', placeholder: '영어 소문자·숫자 (예: haneul12)' });
  const nameInput = el('input', { id: 'su-name', maxlength: '20', autocomplete: 'off', placeholder: '선생님 확인용 (선생님만 봐요)' });
  const pwInput = el('input', { id: 'su-pw', type: 'password', autocomplete: 'new-password', placeholder: '8자 이상' });
  const pw2Input = el('input', { id: 'su-pw2', type: 'password', autocomplete: 'new-password' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, ctx.preview ? '가입 요청 보내기 (미리보기라 안 보내져요)' : '가입 요청 보내기');
  const step2 = el(
    'form',
    { class: 'card signup-step', hidden: true },
    el('h1', {}, '회원가입 (2/2) · 가입 요청'),
    message('가입 요청을 보내면 선생님이 확인하고 승인해요. 승인되면 누리집을 쓸 수 있어요.'),
    el('label', { for: 'su-id' }, '아이디'),
    idInput,
    el('label', { for: 'su-name' }, '이름'),
    nameInput,
    el('label', { for: 'su-pw' }, '비밀번호'),
    pwInput,
    el('label', { for: 'su-pw2' }, '비밀번호 한 번 더'),
    pw2Input,
    message('⚠️ 비밀번호는 다른 사람에게 절대 알려 주지 마세요. 친구 아이디로 로그인하는 것도 안 돼요.', 'warn'),
    status,
    el('div', { class: 'actions' }, submit, el('button', { type: 'button', class: 'secondary', onclick: () => { step2.hidden = true; step1.hidden = false; } }, '← 동의로 돌아가기')),
  );

  next.addEventListener('click', () => {
    step1.hidden = true;
    step2.hidden = false;
    idInput.focus();
  });

  step2.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!idInput.value.trim() || !name) return status.replaceChildren(message('아이디와 이름을 써 주세요.', 'error'));
    if (pwInput.value.length < 8) return status.replaceChildren(message('비밀번호는 8자 이상으로 해 주세요.', 'error'));
    if (pwInput.value !== pw2Input.value) return status.replaceChildren(message('비밀번호 두 개가 달라요.', 'error'));
    if (!checks.every((c) => c.box.checked)) return status.replaceChildren(message('두 가지 동의가 필요해요.', 'error'));
    if (ctx.preview) return status.replaceChildren(message('미리보기라서 요청을 보내지 않았어요.', 'ok'));
    withBusy(submit, async () => {
      const { error, signedIn } = await signUp(idInput.value, pwInput.value, name);
      if (error) return status.replaceChildren(message(error.message, 'error'));
      if (signedIn) {
        location.hash = '#/';
      } else {
        status.replaceChildren(message('가입 요청을 보냈어요! 선생님이 승인하면 로그인할 수 있어요.', 'ok'));
        submit.disabled = true;
      }
    });
  });

  if (ctx.preview) view.append(message('👀 미리보기: 지금은 사이트가 닫혀 있어서 학생에게는 이 화면이 보이지 않아요.', 'warn'));
  view.append(step1, step2);
}
