import { CONSENTS, PRIVACY_VERSION } from '../privacy.js';
import { el } from '../ui.js';
import { consentDocument } from './signup.js';

export const title = '개인정보 처리방침';

// #/privacy : 언제든 볼 수 있는 개인정보 안내 (로그인 안 해도 됨)
export function render(view) {
  view.append(
    el('h1', {}, '개인정보 처리방침'),
    el('p', { class: 'row-meta' }, `판: ${PRIVACY_VERSION}`),
    ...CONSENTS.map((consent) => el('section', { class: 'card consent' }, el('h2', {}, consent.title), consentDocument(consent))),
    el('p', {}, el('a', { href: '#/' }, '← 돌아가기')),
  );
}
