// 화면 만들기 도우미
// 사용자 입력은 항상 글자(text node)로만 넣는다 → 글에 HTML을 써도 실행되지 않음

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

export function message(text, kind = 'muted') {
  return el('p', { class: kind }, text);
}

export function loading() {
  return message('불러오는 중…');
}

// Supabase 오류를 쉬운 말로
export function errorText(error) {
  if (!error) return '';
  if (error.code === '42501') return '권한이 없어요.';
  if (error.code === 'PGRST301' || /JWT/i.test(error.message)) return '로그인이 끝났어요. 다시 로그인해 주세요.';
  if (error.code === '23514') return '입력한 내용이 너무 길거나 비어 있어요.';
  if (/Failed to fetch|NetworkError/i.test(error.message)) return '인터넷 연결을 확인해 주세요.';
  return `문제가 생겼어요: ${error.message}`;
}

export function errorBox(error) {
  return message(errorText(error), 'error');
}

// 버튼을 누르는 동안 두 번 눌리지 않게
export async function withBusy(button, task) {
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

export function displayName(profile) {
  if (!profile) return '(알 수 없음)';
  return profile.nickname ? `${profile.nickname} (${profile.username})` : profile.username;
}

// ---- 날짜 (브라우저의 현지 시각 기준, YYYY-MM-DD 문자열) ----

export function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today() {
  return toDateStr(new Date());
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateStr(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str ?? '') && !Number.isNaN(parseDate(str).getTime());
}

export function addDays(str, days) {
  const date = parseDate(str);
  date.setDate(date.getDate() + days);
  return toDateStr(date);
}

export function daysUntil(str) {
  return Math.round((parseDate(str) - parseDate(today())) / 86400000);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDate(str) {
  const date = parseDate(str);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${formatDate(toDateStr(date))} ${time}`;
}

// ◀ [날짜] ▶ 오늘 : 날짜를 바꾸면 주소(#/경로?date=...)가 바뀜
export function dateNav(path, date) {
  const go = (d) => {
    location.hash = `#${path}?date=${d}`;
  };
  const input = el('input', { type: 'date', value: date, 'aria-label': '날짜 고르기' });
  input.addEventListener('change', () => isDateStr(input.value) && go(input.value));
  return el(
    'div',
    { class: 'date-nav' },
    el('button', { type: 'button', class: 'secondary', onclick: () => go(addDays(date, -1)), 'aria-label': '전날' }, '◀'),
    input,
    el('button', { type: 'button', class: 'secondary', onclick: () => go(addDays(date, 1)), 'aria-label': '다음날' }, '▶'),
    date === today() ? null : el('button', { type: 'button', class: 'secondary', onclick: () => go(today()) }, '오늘'),
  );
}
