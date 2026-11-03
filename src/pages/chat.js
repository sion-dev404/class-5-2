import { supabase } from '../supabase.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '1:1 대화';

const CONTENT_MAX = 500;
const REFRESH_MS = 4000; // 대화창을 열어 둔 동안 새 글을 확인하는 간격

// #/chat          → 대화 목록 + 새 대화 시작
// #/chat/<계정번호> → 그 친구와의 대화
export function render(view, ctx) {
  const [friendId] = ctx.params;
  if (!friendId) return renderList(view, ctx);
  if (!/^[0-9a-f-]{36}$/.test(friendId)) {
    view.append(message('없는 대화예요.'), el('a', { href: '#/chat' }, '대화 목록으로'));
    return;
  }
  return renderThread(view, ctx, friendId);
}

// 내가 안 읽은 메시지 개수 (홈에서 "알림" 대신 보여 줌)
export async function countUnread() {
  const { count, error } = await supabase.from('messages').select('id', { count: 'exact', head: true }).is('read_at', null);
  return error ? 0 : (count ?? 0);
}

async function renderList(view, ctx) {
  view.append(
    el('h1', {}, '1:1 대화'),
    message('🔒 대화한 두 사람만 볼 수 있어요. 관리자도 볼 수 없어요. 괴롭히는 말을 받으면 그 메시지의 "신고"를 눌러 주세요.', 'ok'),
  );
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: profiles, error: profileError }, { data: recent, error: recentError }, { data: unread }] = await Promise.all([
    supabase.from('profiles').select('id, username, nickname, role').eq('status', 'approved').neq('id', ctx.user.id).order('username'),
    supabase.from('messages').select('id, sender_id, recipient_id, content, created_at').order('created_at', { ascending: false }).limit(300),
    supabase.from('messages').select('sender_id').is('read_at', null),
  ]);
  if (profileError || recentError) {
    box.replaceChildren(errorBox(profileError ?? recentError));
    return;
  }

  const byId = new Map(profiles.map((p) => [p.id, p]));
  const unreadBy = new Map();
  for (const row of unread ?? []) unreadBy.set(row.sender_id, (unreadBy.get(row.sender_id) ?? 0) + 1);

  // 친구마다 가장 최근 메시지 하나 (최신 순으로 이미 정렬되어 있음)
  const latest = new Map();
  for (const m of recent) {
    const other = m.sender_id === ctx.user.id ? m.recipient_id : m.sender_id;
    if (!latest.has(other)) latest.set(other, m);
  }

  const talks = [...latest]
    .filter(([id]) => byId.has(id))
    .map(([id, m]) =>
      el(
        'li',
        {},
        el(
          'a',
          { class: 'row-link', href: `#/chat/${id}` },
          el(
            'div',
            { class: 'row-title' },
            displayName(byId.get(id)),
            unreadBy.get(id) ? el('span', { class: 'unread-badge', title: `안 읽은 메시지 ${unreadBy.get(id)}개` }, String(unreadBy.get(id))) : null,
          ),
          el('div', { class: 'row-meta' }, `${m.sender_id === ctx.user.id ? '나: ' : ''}${m.content.slice(0, 40)} · ${formatDateTime(m.created_at)}`),
        ),
      ),
    );

  const friends = profiles.map((p) => el('a', { class: 'friend-chip', href: `#/chat/${p.id}` }, displayName(p)));

  box.replaceChildren(
    el('section', { class: 'card' }, el('h2', {}, '대화'), talks.length ? el('ul', { class: 'list' }, talks) : message('아직 대화가 없어요. 아래에서 친구를 골라 첫 인사를 해 보세요!')),
    el('section', { class: 'card' }, el('h2', {}, '새 대화 시작'), friends.length ? el('div', { class: 'friend-chips' }, friends) : message('대화할 친구가 아직 없어요.')),
  );
}

async function renderThread(view, ctx, friendId) {
  const { data: friend, error } = await supabase.from('profiles').select('id, username, nickname').eq('id', friendId).eq('status', 'approved').maybeSingle();
  if (error || !friend || friendId === ctx.user.id) {
    view.append(error ? errorBox(error) : message('대화할 수 없는 친구예요.'), el('a', { href: '#/chat' }, '← 대화 목록으로'));
    return;
  }

  const log = el('div', { class: 'chat-log', 'aria-live': 'polite' }, loading());
  const status = el('div');
  const input = el('textarea', { id: 'chat-input', maxlength: String(CONTENT_MAX), rows: '2', placeholder: '메시지를 써요 (500자 이내)', required: true });
  const send = el('button', { type: 'submit' }, '보내기');
  const form = el('form', { class: 'chat-form' }, input, send);

  view.append(el('div', { class: 'toolbar' }, el('a', { href: '#/chat' }, '←'), el('h1', {}, displayName(friend))), log, status, form);

  let lastStamp = '';

  async function load() {
    const { data, error: loadError } = await supabase
      .from('messages')
      .select('id, sender_id, content, created_at, read_at')
      .or(`and(sender_id.eq.${ctx.user.id},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${ctx.user.id})`)
      .order('created_at', { ascending: false })
      .limit(100);
    if (loadError) {
      log.replaceChildren(errorBox(loadError));
      return;
    }
    const messages = data.reverse();
    // 바뀐 게 없으면 다시 그리지 않음 (스크롤·입력 중인 글을 건드리지 않게)
    const stamp = `${messages.length}:${messages.at(-1)?.id ?? 0}:${messages.filter((m) => m.read_at).length}`;
    if (stamp === lastStamp) return;
    const first = lastStamp === '';
    lastStamp = stamp;

    const nearBottom = first || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren(...(messages.length ? messages.map(bubble) : [message('아직 메시지가 없어요. 먼저 인사해 보세요! 👋')]));
    if (nearBottom) log.scrollTop = log.scrollHeight;

    // 받은 메시지를 읽음으로 표시
    if (messages.some((m) => m.sender_id === friendId && !m.read_at)) {
      await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('sender_id', friendId).is('read_at', null);
    }
  }

  function bubble(m) {
    const mine = m.sender_id === ctx.user.id;
    const action = mine
      ? el('button', { type: 'button', class: 'secondary small', onclick: () => remove(m.id) }, '지우기')
      : el('button', { type: 'button', class: 'secondary small', onclick: () => report(m.id) }, '신고');
    return el(
      'div',
      { class: `bubble ${mine ? 'mine' : 'theirs'}` },
      el('div', { class: 'bubble-text' }, m.content),
      el('div', { class: 'row-meta' }, `${formatDateTime(m.created_at)}${mine && m.read_at ? ' · 읽음' : ''}`),
      el('div', { class: 'bubble-actions' }, action),
    );
  }

  async function remove(id) {
    if (!confirm('이 메시지를 지울까요? 상대방 화면에서도 사라져요.')) return;
    const { error: deleteError } = await supabase.from('messages').delete().eq('id', id);
    if (deleteError) status.replaceChildren(errorBox(deleteError));
    lastStamp = '';
    load();
  }

  async function report(id) {
    if (!confirm('이 메시지를 신고할까요? 이 메시지와 앞 대화 몇 줄이 관리자에게 전달돼요.')) return;
    const { error: reportError } = await supabase.rpc('report_message', { p_message_id: id });
    status.replaceChildren(reportError ? errorBox(reportError) : message('신고했어요. 관리자가 확인할 거예요.', 'ok'));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    withBusy(send, async () => {
      status.replaceChildren();
      const { error: sendError } = await supabase.from('messages').insert({ recipient_id: friendId, content });
      if (sendError) {
        status.replaceChildren(errorBox(sendError));
        return;
      }
      input.value = '';
      lastStamp = '';
      await load();
    });
  });
  // Enter 로 보내기 (Shift+Enter 는 줄바꿈)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  await load();

  // 열어 둔 동안 주기적으로 새 메시지 확인. 다른 화면으로 가면 멈춤
  const timer = setInterval(() => {
    if (!view.isConnected) return clearInterval(timer);
    load();
  }, REFRESH_MS);
}
