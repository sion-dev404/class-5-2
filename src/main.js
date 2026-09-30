import './style.css';
import { configError } from './supabase.js';
import * as home from './pages/home.js';
import * as board from './pages/board.js';
import * as lessons from './pages/lessons.js';
import * as homework from './pages/homework.js';
import * as meal from './pages/meal.js';

// 주소의 # 뒤 경로 → 페이지
const routes = {
  '/': home,
  '/board': board,
  '/lessons': lessons,
  '/homework': homework,
  '/meal': meal,
};

const app = document.getElementById('app');
const menuLinks = document.querySelectorAll('#menu a');

function currentPath() {
  const path = location.hash.replace(/^#/, '') || '/';
  return path.split('?')[0];
}

function render() {
  const path = currentPath();
  const page = routes[path];

  menuLinks.forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
  });

  app.replaceChildren();
  if (page) {
    document.title = `${page.title} · 5학년 2반`;
    page.render(app);
  } else {
    const p = document.createElement('p');
    p.textContent = '없는 페이지예요.';
    app.append(p);
  }
}

if (configError) {
  const box = document.createElement('p');
  box.className = 'error';
  box.textContent = configError;
  document.getElementById('notice').append(box);
}

window.addEventListener('hashchange', render);
render();
