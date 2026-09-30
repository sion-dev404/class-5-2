// 페이지 공통: 제목과 안내 문장을 그린다. (사용자 입력은 항상 textContent로 넣는다)
export function renderPlaceholder(container, heading, text) {
  const h1 = document.createElement('h1');
  h1.textContent = heading;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  container.append(h1, p);
}
