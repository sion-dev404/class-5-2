import { renderPlaceholder } from './page.js';

export const title = '오늘의 수업';

export function render(container) {
  renderPlaceholder(container, '오늘의 수업', '날짜별 수업 내용이 들어올 곳이에요. (M5에서 만들어요)');
}
