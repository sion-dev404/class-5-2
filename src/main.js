import './style.css';
import { configError } from './supabase.js';
import { getCurrentUser, isAdmin, onSignedOut, signOut } from './auth.js';
import { el, message } from './ui.js';
import * as login from './pages/login.js';
import * as me from './pages/me.js';
import * as home from './pages/home.js';
import * as board from './pages/board.js';
import * as lessons from './pages/lessons.js';
import * as homework from './pages/homework.js';
import * as meal from './pages/meal.js';

// 주소의 # 뒤 첫 부분 → 페이지 (예: #/board/12 → board, 나머지 ['12']는 params)
const routes = {
  '': home,
  board,
  lessons,
  homework,
  meal,
  me,
  login,
};

const app = document.getElementById('app');
const menu = document.getElementById('menu');
const userArea = document.getElementById('user-area');
const notice = document.getElementById('notice');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, queryString = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  return {
    name: segments[0] ?? '',
    params: segments.slice(1),
    query: new URLSearchParams(queryString),
  };
}

function updateHeader(user, name) {
  menu.hidden = !user;
  menu.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
  });

  userArea.replaceChildren();
  if (!user) return;
  userArea.append(
    el(
      'a',
      { href: '#/me', class: name === 'me' ? 'active' : null, title: '내 정보 · 별명 바꾸기' },
      `${user.nickname ?? user.username}${isAdmin(user) ? ' (선생님)' : ''} ✏️`,
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'secondary small',
        onclick: async () => {
          await signOut();
          location.hash = '#/login';
        },
      },
      '로그아웃',
    ),
  );
}

async function render() {
  const route = parseHash();
  const user = await getCurrentUser();

  // 로그인 안 했으면 무조건 로그인 화면, 로그인했으면 로그인 화면 대신 홈
  if (!user && route.name !== 'login') {
    location.replace('#/login');
    return;
  }
  if (user && route.name === 'login') {
    location.replace('#/');
    return;
  }

  updateHeader(user, route.name);

  // 페이지마다 새 틀을 만든다. (늦게 도착한 이전 페이지 결과가 새 화면을 덮지 않도록)
  const view = el('div', { class: 'view' });
  app.replaceChildren(view);

  const page = routes[route.name];
  if (!page) {
    document.title = '5학년 2반';
    view.append(message('없는 페이지예요.'), el('a', { href: '#/' }, '홈으로'));
    return;
  }

  document.title = `${page.title} · 5학년 2반`;
  const ctx = {
    user,
    params: route.params,
    query: route.query,
    refresh: render,
    afterLogin: () => {
      location.hash = '#/';
    },
  };
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
  if (!location.hash) history.replaceState(null, '', '#/');
  window.addEventListener('hashchange', render);
  onSignedOut(() => {
    if (parseHash().name !== 'login') location.hash = '#/login';
  });
  render();
}
