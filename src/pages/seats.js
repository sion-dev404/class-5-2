import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster } from '../roster.js';
import { drawGroups, groupSizes, violations } from '../seating.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '자리 뽑기';

const SIZE_KEY = 'seat-group-size';

function savedSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return n >= 2 && n <= 8 ? n : 4;
  } catch {
    return 4;
  }
}

function tabs(active) {
  return el(
    'div',
    { class: 'toolbar' },
    el('h1', {}, '자리 뽑기'),
    el('span', { class: 'spacer' }),
    el('a', { class: active === 'draw' ? 'button' : 'button secondary-link', href: '#/seats' }, '뽑기'),
    el('a', { class: active === 'settings' ? 'button' : 'button secondary-link', href: '#/seats/settings' }, '설정'),
  );
}

// #/seats           → 뽑기 (랜덤, 직접 바꾸기, 저장)
// #/seats/settings  → 설정 (모둠 크기, 같은 모둠 금지)
export async function render(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 볼 수 있는 화면이에요.', 'error'));
    return;
  }
  const mode = ctx.params[0] === 'settings' ? 'settings' : 'draw';
  view.append(tabs(mode));
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: roster, error }, { data: rules, error: rError }, names] = await Promise.all([
    fetchRoster(),
    supabase.from('seat_rules').select('id, member_ids, note').order('id'),
    realNames(ctx.user),
  ]);
  if (error || rError) {
    box.replaceChildren(errorBox(error ?? rError));
    return;
  }
  const students = roster ?? [];
  const byId = new Map(students.map((s) => [s.id, s]));
  const label = (id) => (byId.get(id) ? withRealName(displayName(byId.get(id)), id, names) : '(없는 계정)');

  if (mode === 'settings') box.replaceChildren(...settingsView(ctx, students, rules, label));
  else box.replaceChildren(...(await drawView(ctx, students, rules, label)));
}

// ---------- 설정 ----------

function settingsView(ctx, students, rules, label) {
  // 모둠 크기 (이 컴퓨터에 기억)
  const sizeInput = el('input', { id: 'seat-size', type: 'number', min: '2', max: '8', value: String(savedSize()) });
  const preview = el('p', { class: 'row-meta' });
  const updatePreview = () => {
    const n = Math.min(8, Math.max(2, Number(sizeInput.value) || 4));
    const sizes = groupSizes(students.length, n);
    preview.textContent = `학생 ${students.length}명 → ${sizes.length}모둠 (${sizes.join(', ')}명)`;
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {
      // 저장이 안 되는 브라우저면 이번만 사용
    }
  };
  sizeInput.addEventListener('input', updatePreview);
  updatePreview();

  // 같은 모둠 금지 묶음 만들기
  const picks = new Map();
  const noteInput = el('input', { id: 'rule-note', maxlength: '50', placeholder: '메모 (선택, 예: 서로 장난이 심함)' });
  const status = el('div');
  const add = el('button', { type: 'submit' }, '금지 묶음 추가');
  const form = el(
    'form',
    { class: 'card' },
    el('h2', {}, '같은 모둠 금지'),
    message('함께 앉으면 안 되는 학생들을 2명 이상 골라 묶음으로 추가하세요. 묶음 안의 학생끼리는 서로 다른 모둠이 돼요.'),
    el(
      'div',
      { class: 'student-picks' },
      students.map((s) => {
        const box = el('input', { type: 'checkbox', value: s.id });
        picks.set(s.id, box);
        return el('label', { class: 'pick' }, box, ` ${label(s.id)}`);
      }),
    ),
    el('label', { for: 'rule-note' }, '메모'),
    noteInput,
    status,
    el('div', { class: 'actions' }, add),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ids = [...picks].filter(([, c]) => c.checked).map(([id]) => id);
    if (ids.length < 2) return status.replaceChildren(message('학생을 2명 이상 골라 주세요.', 'error'));
    withBusy(add, async () => {
      const { error } = await supabase.from('seat_rules').insert({ member_ids: ids, note: noteInput.value.trim() || null });
      if (error) return status.replaceChildren(errorBox(error));
      ctx.refresh();
    });
  });

  const listStatus = el('div');
  const ruleList = el(
    'section',
    { class: 'card' },
    el('h2', {}, `지금 설정된 금지 묶음 ${rules.length}개`),
    rules.length
      ? el(
          'ul',
          { class: 'list compact' },
          rules.map((rule) => {
            const remove = el('button', { type: 'button', class: 'danger small' }, '삭제');
            remove.addEventListener('click', () =>
              withBusy(remove, async () => {
                const { error } = await supabase.from('seat_rules').delete().eq('id', rule.id);
                if (error) return listStatus.replaceChildren(errorBox(error));
                ctx.refresh();
              }),
            );
            return el(
              'li',
              { class: 'item-head' },
              el('span', {}, '🚫 ', rule.member_ids.map(label).join(' · ')),
              rule.note ? el('span', { class: 'row-meta' }, rule.note) : null,
              el('span', { class: 'spacer' }),
              remove,
            );
          }),
        )
      : message('아직 없어요. 없으면 완전히 랜덤으로 뽑아요.'),
    listStatus,
  );

  return [
    el('section', { class: 'card' }, el('h2', {}, '모둠 크기'), el('div', { class: 'field-row' }, el('div', {}, el('label', { for: 'seat-size' }, '한 모둠 인원'), sizeInput)), preview),
    ruleList,
    form,
  ];
}

// ---------- 뽑기 ----------

async function drawView(ctx, students, rules, label) {
  const size = savedSize();
  const { data: history } = await supabase.from('seat_draws').select('id, group_size, groups, created_at').order('created_at', { ascending: false }).limit(10);

  let groups = history?.[0]?.groups ?? null; // 마지막으로 저장한 배치에서 시작
  let picked = null; // 바꾸려고 처음 누른 학생 [모둠, 자리]
  let dirty = false;

  const board = el('div', { class: 'seat-board' });
  const status = el('div');
  const info = el('p', { class: 'row-meta' });

  function drawBoard() {
    if (!groups) {
      board.replaceChildren(message('아직 뽑은 자리가 없어요. "랜덤 뽑기"를 눌러 보세요.'));
      info.textContent = '';
      return;
    }
    const bad = violations(groups, rules);
    board.replaceChildren(
      ...groups.map((group, gi) =>
        el(
          'section',
          { class: `card seat-group ${bad.has(gi) ? 'bad' : ''}` },
          el('h3', {}, `${gi + 1}모둠`, bad.has(gi) ? el('span', { class: 'badge today' }, ' 금지 조건 어김') : null),
          el(
            'ul',
            { class: 'seat-list' },
            group.map((id, si) =>
              el(
                'li',
                {},
                el(
                  'button',
                  {
                    type: 'button',
                    class: `seat ${picked && picked[0] === gi && picked[1] === si ? 'picked' : ''}`,
                    onclick: () => pick(gi, si),
                  },
                  label(id),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    info.textContent = `${students.length}명 · ${groups.length}모둠 · 두 학생을 차례로 누르면 자리가 바뀌어요${dirty ? ' · 저장하지 않은 변경 있음' : ''}`;
  }

  // 선생님 직접 설정: 두 학생을 눌러 자리 바꾸기
  function pick(gi, si) {
    if (!picked) {
      picked = [gi, si];
    } else {
      const [g1, s1] = picked;
      [groups[g1][s1], groups[gi][si]] = [groups[gi][si], groups[g1][s1]];
      picked = null;
      dirty = true;
    }
    drawBoard();
  }

  const drawButton = el('button', { type: 'button', class: 'big' }, '🎲 랜덤 뽑기');
  drawButton.addEventListener('click', () =>
    withBusy(drawButton, async () => {
      const result = drawGroups(students.map((s) => s.id), size, rules);
      if (result.error) return status.replaceChildren(message(result.error, 'error'));
      // 잠깐 섞이는 모습 보여 주기
      for (let i = 0; i < 8; i++) {
        groups = drawGroups(students.map((s) => s.id), size, []).groups;
        drawBoard();
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
      groups = result.groups;
      picked = null;
      dirty = true;
      status.replaceChildren(message(rules.length ? `금지 묶음 ${rules.length}개를 지켜서 뽑았어요.` : '랜덤으로 뽑았어요.', 'ok'));
      drawBoard();
    }),
  );

  const saveButton = el('button', { type: 'button', class: 'secondary' }, '이 자리로 저장');
  saveButton.addEventListener('click', () => {
    if (!groups) return;
    if (violations(groups, rules).size && !confirm('금지 조건을 어긴 모둠이 있어요. 그래도 저장할까요?')) return;
    withBusy(saveButton, async () => {
      const { error } = await supabase.from('seat_draws').insert({ group_size: size, groups });
      if (error) return status.replaceChildren(errorBox(error));
      dirty = false;
      ctx.refresh();
    });
  });

  // 지난 기록 불러오기
  const historySection = el(
    'section',
    { class: 'card' },
    el('h2', {}, '저장한 기록 (최근 10개)'),
    history?.length
      ? el(
          'ul',
          { class: 'list compact' },
          history.map((h, i) =>
            el(
              'li',
              { class: 'item-head' },
              el('span', {}, `${formatDateTime(h.created_at)} · ${h.groups.length}모둠`),
              i === 0 ? el('span', { class: 'badge later' }, '지금 자리') : null,
              el('span', { class: 'spacer' }),
              el(
                'button',
                {
                  type: 'button',
                  class: 'secondary small',
                  onclick: () => {
                    groups = h.groups.map((g) => [...g]);
                    picked = null;
                    dirty = i !== 0;
                    drawBoard();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  },
                },
                '불러오기',
              ),
            ),
          ),
        )
      : message('아직 저장한 자리가 없어요.'),
  );

  drawBoard();
  return [
    el(
      'section',
      { class: 'card' },
      el('div', { class: 'actions' }, drawButton, saveButton),
      el('p', { class: 'row-meta' }, `모둠 크기 ${size}명 · 같은 모둠 금지 ${rules.length}개 (바꾸려면 "설정")`),
      status,
    ),
    info,
    board,
    historySection,
  ];
}
