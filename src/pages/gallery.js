import { supabase } from '../supabase.js';
import { signedUrls } from '../files.js';
import { el, errorBox, loading, message, withBusy } from '../ui.js';

export const title = '갤러리';

const PAGE_SIZE = 24;

// #/gallery : 게시판·보드 글에 첨부된 사진을 모아 보기 (최신 순). 사진을 누르면 그 글로
export async function render(view) {
  view.append(el('h1', {}, '우리반 갤러리'), message('게시판과 보드에 올린 사진이 모여요. 사진을 누르면 그 글로 가요.'));
  const grid = el('div', { class: 'gallery-grid' });
  const status = el('div', {}, loading());
  const more = el('button', { type: 'button', class: 'secondary', hidden: true }, '사진 더 보기');
  view.append(grid, status, el('div', { class: 'actions center' }, more));

  let from = 0;
  async function load() {
    const { data, error } = await supabase
      .from('post_files')
      .select('id, path, name, post_id, post:posts(title)')
      .like('mime', 'image/%')
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      status.replaceChildren(errorBox(error));
      return;
    }
    if (from === 0 && data.length === 0) {
      status.replaceChildren(message('아직 사진이 없어요. 게시판에 사진을 올려 보세요.'));
      return;
    }
    let urls = {};
    try {
      urls = await signedUrls(data.map((file) => file.path));
    } catch (urlError) {
      status.replaceChildren(errorBox(urlError));
      return;
    }
    grid.append(
      ...data
        .filter((file) => urls[file.path])
        .map((file) =>
          el(
            'a',
            { class: 'gallery-item', href: `#/board/${file.post_id}`, title: file.post?.title ?? '' },
            el('img', { src: urls[file.path], alt: file.name, loading: 'lazy' }),
            el('span', { class: 'gallery-caption' }, file.post?.title ?? ''),
          ),
        ),
    );
    from += data.length;
    status.replaceChildren();
    more.hidden = data.length < PAGE_SIZE;
  }

  more.addEventListener('click', () => withBusy(more, load));
  await load();
}
