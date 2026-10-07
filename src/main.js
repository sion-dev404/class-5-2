import './style.css';
import { configError, supabase } from './supabase.js';
import { forgetUser, getCurrentUser, isAdmin, isApproved, needsOnboarding, onSignedOut, signOut } from './auth.js';
import { el, message } from './ui.js';
import * as login from './pages/login.js';
import * as me from './pages/me.js';
import * as home from './pages/home.js';
import * as board from './pages/board.js';
import * as lessons from './pages/lessons.js';
import * as homework from './pages/homework.js';
import * as meal from './pages/meal.js';
import * as admin from './pages/admin.js';
import * as topics from './pages/topics.js';
import * as quiz from './pages/quiz.js';
import * as gallery from './pages/gallery.js';
import * as points from './pages/points.js';
import * as seats from './pages/seats.js';
import * as site from './pages/site.js';
import * as signup from './pages/signup.js';
import * as privacy from './pages/privacy.js';

// 주소의 # 뒤 첫 부분 → 페이지 (예: #/board/12 → board, 나머지 ['12']는 params)
const routes = {
  '': home,
  board,
  lessons,
  homework,
  meal,
  me,
  admin,
  topics,
  quiz,
  gallery,
  points,
  seats,
  site,
  signup,
  privacy,
  login,
};

// 로그인하지 않아도 볼 수 있는 화면
const PUBLIC_ROUTES = ['login', 'signup', 'privacy'];

// 메뉴: 비슷한 것끼리 한 곳에 모으고, 안에서 탭으로 이동 (캘린더는 홈에 그대로)
const GROUPS = [
  { label: '소통', tabs: [['board', '게시판'], ['topics', '보드'], ['gallery', '갤러리']] },
  { label: '수업', tabs: [['lessons', '오늘의 수업'], ['homework', '숙제'], ['meal', '급식']] },
  { label: '퀴즈', tabs: [['quiz', '퀴즈'], ['points', '순위']] },
  { label: '관리', admin: true, tabs: [['admin', '학생 관리'], ['seats', '자리'], ['site', '사이트']] },
];
const groupOf = (name) => GROUPS.find((group) => group.tabs.some(([route]) => route === name));

const app = document.getElementById('app');
const menu = document.getElementById('menu');
const userArea = document.getElementById('user-area');
const notice = document.getElementById('notice');
const banner = el('div');
notice.append(banner);

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

// 사이트 열림/닫힘 (표가 아직 없거나 못 읽으면 열린 것으로 봄 — 실제 잠금은 DB가 함)
async function siteStatus() {
  const { data, error } = await supabase.from('site_settings').select('closed, notice').eq('id', 1).maybeSingle();
  if (error || !data) return { closed: false, notice: '' };
  return data;
}

function updateHeader(user, name) {
  menu.hidden = !user;
  const current = groupOf(name);
  menu.replaceChildren(
    el('a', { href: '#/', class: name === '' ? 'active' : null }, '홈'),
    ...GROUPS.filter((group) => !group.admin || isAdmin(user)).map((group) =>
      el('a', { href: `#/${group.tabs[0][0]}`, class: group === current ? 'active' : null, id: group.admin ? 'admin-link' : null }, group.label),
    ),
  );

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

// 같은 메뉴 안의 탭 (예: 소통 → 게시판 | 보드 | 갤러리)
function tabsFor(route) {
  const group = groupOf(route.name);
  if (!group || route.params[1] === 'race') return null;
  return el(
    'nav',
    { class: 'tabs', 'aria-label': group.label },
    group.tabs.map(([name, label]) => el('a', { href: `#/${name}`, class: name === route.name ? 'active' : null }, label)),
  );
}

// 처음 들어올 때(브라우저를 새로 열 때마다) 보여 주는 경고
function showWarning() {
  try {
    if (sessionStorage.getItem('warning-ok') === '1') return;
  } catch {
    // 저장이 안 되는 브라우저면 매번 보여 줌
  }
  const ok = el('button', { type: 'button', class: 'big' }, '확인했어요');
  const box = el(
    'div',
    { class: 'warning-overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'warning-title' },
    el(
      'div',
      { class: 'warning-box' },
      el('div', { class: 'warning-icon', 'aria-hidden': 'true' }, '⚠️'),
      el('h2', { id: 'warning-title' }, '경고'),
      el('p', {}, '이 누리집은 접속하는 사람의 ', el('strong', {}, 'IP 주소를 기록'), '하고 있어요.'),
      el('p', {}, el('strong', {}, '다른 사람에게 피해를 주는 일은 절대 하지 마세요.'), ' 다른 사람의 아이디로 로그인하기, 친구를 괴롭히는 글·댓글 쓰기도 안 돼요.'),
      el('p', { class: 'row-meta' }, '문제가 생기면 기록으로 확인해요.'),
      ok,
    ),
  );
  ok.addEventListener('click', () => {
    try {
      sessionStorage.setItem('warning-ok', '1');
    } catch {
      // 무시
    }
    box.remove();
  });
  document.body.append(box);
  ok.focus();
}

// 로그인한 사람의 접속 기록 (브라우저를 열 때마다 한 번)
async function logVisit(user) {
  const key = `visit-${user.id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // 저장이 안 되면 그냥 기록
  }
  await supabase.rpc('log_visit');
}

// 가입 요청 후 선생님 승인을 기다리는 화면
function pendingPage(view, user) {
  document.title = '승인 대기 · 5학년 2반';
  view.append(
    el(
      'section',
      { class: 'card closed-page' },
      el('div', { class: 'closed-icon', 'aria-hidden': 'true' }, '⏳'),
      el('h1', {}, '승인을 기다리고 있어요'),
      el('p', {}, `${user.username} 계정의 가입 요청을 선생님께 보냈어요. 선생님이 승인하면 누리집을 쓸 수 있어요.`),
      el('p', { class: 'row-meta' }, '승인되면 이 화면을 새로고침해 보세요.'),
      el('div', { class: 'actions center' }, el('button', { type: 'button', class: 'secondary', onclick: () => location.reload() }, '새로고침'), el('button', { type: 'button', class: 'secondary', onclick: async () => { await signOut(); location.hash = '#/login'; } }, '로그아웃')),
    ),
    el('p', { class: 'closed-admin' }, el('a', { href: '#/privacy' }, '개인정보 처리방침')),
  );
}

// 학생에게 보이는 "사이트 폐쇄" 화면
function closedPage(view, text) {
  document.title = '사이트 폐쇄 · 5학년 2반';
  view.append(
    el(
      'section',
      { class: 'card closed-page' },
      el('div', { class: 'closed-icon', 'aria-hidden': 'true' }, '🚫'),
      el('h1', {}, '사이트 폐쇄'),
      el('p', { class: 'closed-notice' }, text || '도용 사건으로 사이트가 종료되었습니다.'),
    ),
    el('p', { class: 'closed-admin' }, el('a', { href: '#/login?admin=1' }, '선생님(관리자) 로그인')),
  );
}

// Google 로그인에서 돌아왔을 때: 실패 이유를 읽고, 주소의 ?code= / ?error= 를 깨끗이 지움
let loginError = '';
function readOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const description = params.get('error_description') ?? params.get('error');
  if (description) {
    loginError = /goedu|database error|saving new user/i.test(description)
      ? '학교 Google 계정(goedu.kr)으로만 로그인할 수 있어요. 학교 계정으로 다시 해 주세요.'
      : /signups? not allowed|disabled/i.test(description)
        ? '지금은 새로 가입을 받지 않아요. 선생님께 물어봐 주세요.'
        : `Google 로그인에 실패했어요: ${description}`;
  }
}
function cleanOAuthUrl() {
  if (location.search) history.replaceState(null, '', location.pathname + (location.hash || '#/'));
}

async function render() {
  const route = parseHash();
  const [user, status] = await Promise.all([getCurrentUser(), siteStatus()]);
  cleanOAuthUrl(); // 로그인 처리(코드 교환)가 끝난 뒤에 주소 정리
  const adminUser = isAdmin(user);

  // 페이지마다 새 틀을 만든다. (늦게 도착한 이전 페이지 결과가 새 화면을 덮지 않도록)
  const view = el('div', { class: 'view' });

  // 사이트가 닫혔으면: 학생·비로그인은 폐쇄 화면 (선생님 로그인 칸만 열어 둠)
  banner.replaceChildren();
  if (status.closed && !adminUser) {
    if (user) {
      await signOut(); // 학생 로그인은 끊음
      return;
    }
    updateHeader(null, route.name);
    app.replaceChildren(view);
    if (route.name === 'privacy') {
      document.title = `${privacy.title} · 5학년 2반`;
      privacy.render(view);
    } else if (route.name === 'login' && route.query.get('admin') === '1') {
      document.title = '선생님 로그인 · 5학년 2반';
      await login.render(view, { query: route.query, params: [], adminOnly: true, loginError, afterLogin: () => (location.hash = '#/') });
      view.prepend(message('선생님(관리자) 계정만 로그인할 수 있어요. 학생 계정은 사이트가 닫혀 있어 들어갈 수 없어요.', 'warn'));
      view.append(el('p', { class: 'closed-admin' }, el('a', { href: '#/login' }, '← 돌아가기')));
    } else {
      closedPage(view, status.notice);
    }
    return;
  }
  if (status.closed && adminUser) {
    banner.append(
      el('p', { class: 'error site-banner' }, '🔒 지금 학생에게는 사이트가 닫혀 있어요 (폐쇄 화면이 보여요). ', el('a', { href: '#/site' }, '관리 → 사이트에서 열기')),
    );
  }

  // 로그인 안 했으면 무조건 로그인 화면, 로그인했으면 로그인 화면 대신 홈
  if (!user && !PUBLIC_ROUTES.includes(route.name)) {
    location.replace('#/login');
    return;
  }
  if (user && (route.name === 'login' || (route.name === 'signup' && !adminUser))) {
    location.replace('#/');
    return;
  }

  // 학교 Google 계정으로 처음 들어옴: 동의 + 아이디 정하기부터
  if (needsOnboarding(user) && route.name !== 'privacy') {
    updateHeader(null, route.name);
    app.replaceChildren(view);
    logVisit(user);
    await signup.renderOnboarding(view, user, () => {
      forgetUser();
      render();
    });
    return;
  }

  // 승인 대기 학생: 승인 화면만 (개인정보 처리방침은 볼 수 있음)
  if (user && !isApproved(user) && route.name !== 'privacy') {
    updateHeader(null, route.name);
    app.replaceChildren(view);
    logVisit(user);
    pendingPage(view, user);
    return;
  }
  if (user) logVisit(user);

  updateHeader(isApproved(user) ? user : null, route.name);
  app.replaceChildren(view);

  const page = routes[route.name];
  if (!page) {
    document.title = '5학년 2반';
    view.append(message('없는 페이지예요.'), el('a', { href: '#/' }, '홈으로'));
    return;
  }

  const tabs = tabsFor(route);
  if (tabs) app.prepend(tabs);

  document.title = `${page.title} · 5학년 2반`;
  const ctx = {
    user,
    preview: route.name === 'signup' && adminUser,
    params: route.params,
    query: route.query,
    refresh: render,
    loginError,
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
  readOAuthReturn();
  if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/');
  showWarning();
  window.addEventListener('hashchange', render);
  onSignedOut(() => {
    if (parseHash().name !== 'login') location.hash = '#/login';
    else render();
  });
  render();
}
