// 첨부 파일 화면 조각 (게시판·보드·오늘의 수업·급식에서 같이 씀)
import { ACCEPT, ALLOWED_TEXT, MAX_FILES, checkFile, download, formatSize, isImage, signedUrls } from './files.js';
import { el, errorBox, message, withBusy } from './ui.js';

// 보기: 사진은 바로 보이고(누르면 크게), 모든 파일에 내려받기 버튼
export async function attachmentsSection(files) {
  if (!files || files.length === 0) return null;
  const status = el('div');
  let urls = {};
  try {
    urls = await signedUrls(files.filter((file) => isImage(file.mime)).map((file) => file.path));
  } catch (error) {
    status.append(errorBox(error));
  }

  const images = files
    .filter((file) => isImage(file.mime) && urls[file.path])
    .map((file) =>
      el('a', { href: urls[file.path], target: '_blank', rel: 'noopener', title: '크게 보기' }, el('img', { src: urls[file.path], alt: file.name, loading: 'lazy' })),
    );

  const list = el(
    'ul',
    { class: 'file-list' },
    files.map((file) => {
      const button = el('button', { type: 'button', class: 'secondary small' }, '내려받기');
      button.addEventListener('click', () =>
        withBusy(button, async () => {
          try {
            await download(file);
          } catch (error) {
            status.replaceChildren(errorBox(error));
          }
        }),
      );
      return el('li', {}, el('span', { class: 'file-name' }, `📎 ${file.name}`), el('span', { class: 'row-meta' }, formatSize(file.size)), button);
    }),
  );

  return el('section', { class: 'attachments' }, images.length ? el('div', { class: 'image-grid' }, images) : null, list, status);
}

// 고르기: 이미 있는 파일(수정할 때) + 새로 고른 파일
//   id    : 입력 칸 id (한 화면에 여러 개면 다르게)
//   label : 칸 이름
export function filePicker(existing, { id = 'post-files', label = '첨부 파일' } = {}) {
  const kept = [...existing];
  const removed = [];
  let added = [];

  const input = el('input', { id, type: 'file', multiple: true, accept: ACCEPT });
  const list = el('ul', { class: 'file-list' });
  const note = el('div');

  function redraw() {
    list.replaceChildren(
      ...kept.map((file) =>
        el(
          'li',
          {},
          el('span', { class: 'file-name' }, `📎 ${file.name}`),
          el('span', { class: 'row-meta' }, formatSize(file.size)),
          el('button', { type: 'button', class: 'danger small', onclick: () => { kept.splice(kept.indexOf(file), 1); removed.push(file); redraw(); } }, '빼기'),
        ),
      ),
      ...added.map((file) =>
        el(
          'li',
          {},
          el('span', { class: 'file-name' }, `🆕 ${file.name}`),
          el('span', { class: 'row-meta' }, formatSize(file.size)),
          el('button', { type: 'button', class: 'danger small', onclick: () => { added = added.filter((f) => f !== file); redraw(); } }, '빼기'),
        ),
      ),
    );
    input.disabled = kept.length + added.length >= MAX_FILES;
  }

  input.addEventListener('change', () => {
    const problems = [];
    for (const file of input.files) {
      const problem = checkFile(file);
      if (problem) problems.push(problem);
      else if (kept.length + added.length >= MAX_FILES) problems.push(`${file.name}: 파일은 ${MAX_FILES}개까지만 올릴 수 있어요.`);
      else added.push(file);
    }
    input.value = '';
    note.replaceChildren(...problems.map((text) => message(text, 'error')));
    redraw();
  });

  redraw();
  return {
    element: el(
      'div',
      {},
      el('label', { for: id }, `${label} (${MAX_FILES}개까지, 하나에 50MB까지)`),
      input,
      el('p', { class: 'row-meta' }, `올릴 수 있는 파일: ${ALLOWED_TEXT}. 사진은 촬영 위치 정보를 지우고 크기를 줄여서 올려요.`),
      note,
      list,
    ),
    get added() {
      return added;
    },
    get removed() {
      return removed;
    },
    get count() {
      return kept.length + added.length;
    },
  };
}
