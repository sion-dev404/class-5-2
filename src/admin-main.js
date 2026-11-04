// 관리자 전용 페이지 (주소: /class-5-2/admin/). 학급 사이트와 따로 열리고, 로그인 정보만 같이 써요.
import './style.css';
import { configError } from './supabase.js';
import { getCurrentUser, isAdmin, onSignedOut, signOut } from './auth.js';
import { el, message } from './ui.js';
import * as login from './pages/login.js';
import * as admin from './pages/admin.js';
import * as seats from './pages/seats.js';
import * as site from './pages/site.js';

const routes = { '': admin, admin, seats, site, login };
const TABS = [['admin', '학생 관리'], ['seats', '자리'], ['site', '사이트']];
const SITE_URL = import.meta.env.BASE_URL; // 학급 사이트 주소

const app = document.getElementById('app');
const menu = document.getElementById('menu');
const userArea = document.getElementById('user-area');
const notice = document.getElementById('notice');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, queryString = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  return { name: segments[0] ?? '', params: segments.slice(1), query: new URLSearchParams(queryString) };
}

function updateHeader(user, name) {
  menu.hidden = !user;
  menu.replaceChildren(
    ...TABS.map(([route, label]) => el('a', { href: `#/${route}`, class: route === name || (name === '' && route === 'admin') ? 'active' : null }, label)),
    el('a', { href: SITE_URL }, '학급 사이트 ↗'),
  );
  userArea.replaceChildren();
  if (!user) return;
  userArea.append(
    el('span', { class: 'row-meta' }, user.nickname ?? user.username),
    el('button', { type: 'button', class: 'secondary small', onclick: async () => { await signOut(); } }, '로그아웃'),
  );
}

async function render() {
  const route = parseHash();
  const user = await getCurrentUser();
  const view = el('div', { class: 'view' });
  notice.replaceChildren();

  // 로그인 전: 관리자 로그인 칸 (구글 버튼 없이 아이디·비밀번호)
  if (!user) {
    updateHeader(null, route.name);
    app.replaceChildren(view);
    document.title = '관리자 로그인 · 5학년 2반';
    await login.render(view, { query: route.query, params: [], adminOnly: true, loginError: '', afterLogin: render });
    view.prepend(message('관리자(김시온) 계정만 들어올 수 있어요.', 'warn'));
    view.append(el('p', { class: 'closed-admin' }, el('a', { href: SITE_URL }, '← 학급 사이트로')));
    return;
  }

  // 관리자가 아니면 막음
  if (!isAdmin(user)) {
    updateHeader(user, route.name);
    app.replaceChildren(view);
    document.title = '관리자 · 5학년 2반';
    view.append(
      message('관리자만 볼 수 있는 페이지예요. 관리자 계정으로 다시 로그인해 주세요.', 'error'),
      el('div', { class: 'actions' }, el('a', { class: 'button', href: SITE_URL }, '학급 사이트로 가기')),
    );
    return;
  }

  updateHeader(user, route.name);
  app.replaceChildren(view);

  const page = routes[route.name === 'login' ? '' : route.name];
  if (!page) {
    document.title = '관리자 · 5학년 2반';
    view.append(message('없는 페이지예요.'), el('a', { href: '#/' }, '학생 관리로'));
    return;
  }
  document.title = `${page.title} · 관리자`;
  const ctx = { user, params: route.params, query: route.query, refresh: render, afterLogin: render };
  try {
    await page.render(view, ctx);
  } catch (error) {
    console.error(error);
    view.replaceChildren(message(`화면을 그리다 문제가 생겼어요: ${error.message}`, 'error'));
  }
}

if (configError) {
  notice.append(message(configError, 'error'));
} else {
  window.addEventListener('hashchange', render);
  onSignedOut(() => render());
  render();
}
