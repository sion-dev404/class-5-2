import { supabase } from '../supabase.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster, participationPanel } from '../roster.js';
import { displayName, el, errorBox, message, withBusy } from '../ui.js';

// ---------- 실시간 퀴즈 공통 ----------

// 바뀜 감지: Realtime(바로) + 2초마다 다시 확인(Realtime이 안 될 때 대비)
// box 가 화면에서 사라지면 저절로 멈춤
function watch(box, quizId, onChange, { answers = false } = {}) {
  let timer = null;
  let pending = false;
  const fire = () => {
    if (!box.isConnected) return stop();
    if (pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;
      if (box.isConnected) await onChange();
    }, 150);
  };
  let channel = supabase
    .channel(`live-${quizId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes', filter: `id=eq.${quizId}` }, fire);
  if (answers) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'live_answers', filter: `quiz_id=eq.${quizId}` }, fire);
  channel.subscribe();
  timer = setInterval(fire, 2000);
  function stop() {
    clearInterval(timer);
    supabase.removeChannel(channel);
  }
  return stop;
}

// 서버 시각 기준 남은 시간
function clock(state) {
  const offset = new Date(state.server_now).getTime() - Date.now();
  const deadline = state.time_limit_sec && state.started_at ? new Date(state.started_at).getTime() + state.time_limit_sec * 1000 : null;
  return {
    left: () => (deadline ? Math.max(0, deadline - (Date.now() + offset)) : null),
    elapsed: () => (state.started_at ? Date.now() + offset - new Date(state.started_at).getTime() : 0),
  };
}

const mmss = (ms) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

async function liveState(quizId) {
  const { data, error } = await supabase.rpc('live_state', { p_quiz_id: quizId });
  if (error) throw error;
  return data;
}

// 학생별 진행: 답한 수, 맞힌 수, 마지막으로 답한 시각 → 순위 (맞힌 수 → 답한 수 → 먼저 끝낸 순)
function standings(roster, answers, total) {
  const stat = new Map(roster.map((s) => [s.id, { student: s, answered: 0, correct: 0, last: null }]));
  for (const a of answers) {
    const s = stat.get(a.user_id);
    if (!s) continue;
    s.answered += 1;
    if (a.correct) s.correct += 1;
    const t = new Date(a.answered_at).getTime();
    if (!s.last || t > s.last) s.last = t;
  }
  const list = [...stat.values()].sort(
    (a, b) => b.correct - a.correct || b.answered - a.answered || (a.last ?? Infinity) - (b.last ?? Infinity) || a.student.username.localeCompare(b.student.username),
  );
  list.forEach((s, i) => {
    s.rank = i + 1;
    s.finished = total > 0 && s.answered >= total;
  });
  return list;
}

const STATUS_TEXT = { waiting: '대기 중', running: '진행 중', ended: '끝' };

// ---------- 관리자: 진행 화면 ----------

export async function renderLiveAdmin(view, ctx, quiz, questions, keys) {
  const box = el('div');
  const status = el('div');
  const [{ data: roster }, names] = await Promise.all([fetchRoster(), realNames(ctx.user)]);
  const students = roster ?? [];

  const control = (action, label, cls, ask) => {
    const button = el('button', { type: 'button', class: cls }, label);
    button.addEventListener('click', () => {
      if (ask && !confirm(ask)) return;
      withBusy(button, async () => {
        const { error } = await supabase.rpc('live_control', { p_quiz_id: quiz.id, p_action: action });
        if (error) return status.replaceChildren(errorBox(error));
        draw();
      });
    });
    return button;
  };

  async function draw() {
    let state;
    try {
      state = await liveState(quiz.id);
    } catch (error) {
      return box.replaceChildren(errorBox(error));
    }
    const { data: answers, error } = await supabase.from('live_answers').select('user_id, question_id, correct, answered_at').eq('quiz_id', quiz.id);
    if (error) return box.replaceChildren(errorBox(error));
    const table = standings(students, answers, state.total);
    const done = new Map(table.filter((s) => s.answered > 0).map((s) => [s.student.id, `${s.answered}/${state.total} · ✔${s.correct}`]));

    box.replaceChildren(
      el(
        'section',
        { class: 'card live-control' },
        el('div', { class: 'item-head' }, el('span', { class: `badge live-${state.status}` }, STATUS_TEXT[state.status]), el('span', { class: 'row-meta' }, `문제 ${state.total}개`)),
        el(
          'div',
          { class: 'actions' },
          state.status === 'waiting' ? control('start', '▶ 시작!', 'big', '지금 시작할까요? 모든 학생 화면에 문제가 나와요.') : null,
          state.status === 'running' ? control('end', '■ 끝내기', 'danger', '지금 끝낼까요?') : null,
          state.status !== 'waiting' ? control('reset', '↺ 처음부터 다시', 'secondary', '모든 학생의 답을 지우고 대기 상태로 돌아갈까요?') : null,
          el('a', { class: 'button', href: `#/quiz/${quiz.id}/race`, target: '_blank', rel: 'noopener' }, '🚀 레이스 화면 열기 (새 창)'),
        ),
        status,
      ),
      participationPanel(students, done, names),
      el(
        'section',
        { class: 'card' },
        el('h2', {}, '실시간 순위'),
        el(
          'ol',
          { class: 'speed-list' },
          table.map((s) =>
            el(
              'li',
              {},
              el('span', { class: 'speed-rank' }, String(s.rank)),
              el('span', { class: 'speed-name' }, withRealName(displayName(s.student), s.student.id, names)),
              el('span', { class: 'row-meta' }, `${s.answered}/${state.total} 답함`),
              el('span', { class: 'speed-time' }, `✔ ${s.correct}`),
            ),
          ),
        ),
      ),
      answerKey(questions, keys),
    );
  }

  view.append(box);
  await draw();
  watch(box, quiz.id, draw, { answers: true });
}

function answerKey(questions, keys) {
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, `문제와 정답 (선생님만 보여요) · 문제 ${questions.length}개`),
    el(
      'ol',
      { class: 'quiz-review' },
      questions.map((q) => {
        const key = keys.get(q.id) ?? '';
        return el(
          'li',
          {},
          el('div', { class: 'row-title' }, q.question),
          q.choices ? el('ol', { class: 'choice-list' }, q.choices.map((c, i) => el('li', { class: String(i + 1) === key ? 'right' : null }, c))) : null,
          el('div', { class: 'row-meta' }, `정답: ${q.choices ? `${key}번 ${q.choices[Number(key) - 1] ?? ''}` : key.split('|').join(' 또는 ')}`),
        );
      }),
    ),
  );
}

// ---------- 관리자: 레이스 화면 (우주) ----------

export async function renderRace(view, ctx, quiz) {
  document.body.classList.add('race-mode');
  const stage = el('div', { class: 'race' });
  view.append(stage);
  const { data: roster } = await fetchRoster();
  const students = roster ?? [];
  let showScore = false;
  let state = null;
  let table = [];
  let tick = null;

  const timerEl = el('div', { class: 'race-timer' });
  const statusEl = el('span', { class: 'race-status' });
  const scoreToggle = el('label', { class: 'race-toggle' }, el('input', { type: 'checkbox', onchange: (e) => { showScore = e.target.checked; paint(); } }), ' 맞힌 수 보이기');
  const startButton = el('button', { type: 'button', class: 'race-button' }, '▶ 시작!');
  const endButton = el('button', { type: 'button', class: 'race-button danger' }, '■ 끝내기');
  const act = (button, action, ask) =>
    button.addEventListener('click', () => {
      if (ask && !confirm(ask)) return;
      withBusy(button, async () => {
        const { error } = await supabase.rpc('live_control', { p_quiz_id: quiz.id, p_action: action });
        if (error) alert(error.message);
        await refresh();
      });
    });
  act(startButton, 'start', '지금 시작할까요?');
  act(endButton, 'end', '지금 끝낼까요?');

  const lanes = el('div', { class: 'race-lanes' });
  const board = el('ol', { class: 'race-board' });
  stage.append(
    el(
      'div',
      { class: 'race-top' },
      el('div', { class: 'race-title' }, `🚀 ${quiz.title}`),
      statusEl,
      timerEl,
      el('span', { class: 'spacer' }),
      scoreToggle,
      startButton,
      endButton,
      el('a', { class: 'race-exit', href: `#/quiz/${quiz.id}` }, '나가기'),
    ),
    el('div', { class: 'race-body' }, el('div', { class: 'race-track' }, el('div', { class: 'race-finish', 'aria-hidden': 'true' }), lanes), el('div', { class: 'race-side' }, el('h2', {}, '🏆 순위'), board)),
  );

  // 레인은 학생마다 한 번 만들고, 위치만 바꿈 (부드럽게 날아가도록)
  const laneOf = new Map();
  for (const s of students) {
    const ship = el('div', { class: 'ship' }, el('span', { class: 'ship-icon', 'aria-hidden': 'true' }, '🚀'), el('span', { class: 'ship-name' }, displayName(s)));
    const lane = el('div', { class: 'lane' }, ship);
    laneOf.set(s.id, { lane, ship });
    lanes.append(lane);
  }

  function paint() {
    if (!state) return;
    statusEl.textContent = STATUS_TEXT[state.status];
    statusEl.className = `race-status live-${state.status}`;
    startButton.hidden = state.status !== 'waiting';
    endButton.hidden = state.status !== 'running';
    if (state.status !== 'running') timerEl.textContent = state.status === 'waiting' ? '준비' : '끝!';
    for (const s of table) {
      const { ship } = laneOf.get(s.student.id);
      const progress = state.total ? s.answered / state.total : 0;
      ship.style.setProperty('--progress', String(progress));
      ship.classList.toggle('finished', s.finished);
      ship.querySelector('.ship-name').textContent = `${displayName(s.student)}${showScore ? ` ✔${s.correct}` : ''}`;
    }
    board.replaceChildren(
      ...table.map((s) =>
        el(
          'li',
          { class: s.finished ? 'finished' : null },
          el('span', { class: 'board-rank' }, s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : String(s.rank)),
          el('span', { class: 'board-name' }, displayName(s.student)),
          el('span', { class: 'board-progress' }, s.finished ? '🏁' : `${s.answered}/${state.total}`, showScore ? ` ✔${s.correct}` : ''),
        ),
      ),
    );
  }

  async function refresh() {
    try {
      state = await liveState(quiz.id);
    } catch (error) {
      statusEl.textContent = error.message;
      return;
    }
    const { data: answers } = await supabase.from('live_answers').select('user_id, correct, answered_at').eq('quiz_id', quiz.id);
    table = standings(students, answers ?? [], state.total);
    paint();
  }

  await refresh();
  const stop = watch(stage, quiz.id, refresh, { answers: true });
  tick = setInterval(() => {
    if (!stage.isConnected) {
      clearInterval(tick);
      stop();
      document.body.classList.remove('race-mode');
      return;
    }
    if (!state) return;
    const c = clock(state);
    if (state.status === 'running') {
      const left = c.left();
      timerEl.textContent = left === null ? `⏱ ${mmss(c.elapsed())}` : `⏱ ${mmss(left)}`;
      timerEl.classList.toggle('urgent', left !== null && left <= 10000);
      if (left === 0) refresh();
    } else {
      timerEl.textContent = state.status === 'waiting' ? '준비' : '끝!';
      timerEl.classList.remove('urgent');
    }
  }, 250);
}

// ---------- 학생: 실시간 풀기 ----------

export async function renderLiveStudent(view, ctx, quiz) {
  const box = el('div', { class: 'live-student' });
  view.append(box);
  let questions = null;
  let mine = new Map(); // question_id → correct
  let state = null;
  let phase = null; // 화면에 그린 단계 (같으면 다시 그리지 않음)
  let tick = null;
  let feedback = null;

  async function load() {
    try {
      state = await liveState(quiz.id);
    } catch (error) {
      box.replaceChildren(errorBox(error));
      return;
    }
    if (state.status !== 'waiting' && !questions) {
      const { data } = await supabase.from('quiz_questions').select('id, position, question, choices').eq('quiz_id', quiz.id).order('position').order('id');
      questions = data ?? [];
    }
    if (state.status === 'waiting') questions = null;
    const { data: answers } = await supabase.from('live_answers').select('question_id, correct').eq('quiz_id', quiz.id).eq('user_id', ctx.user.id);
    mine = new Map((answers ?? []).map((a) => [a.question_id, a.correct]));
    render();
  }

  function render() {
    if (!state) return;
    const next = questions?.find((q) => !mine.has(q.id));
    const timeUp = state.status === 'running' && clock(state).left() === 0;
    const key = state.status === 'waiting' ? 'waiting' : state.status === 'ended' || timeUp ? 'ended' : next ? `q-${next.id}` : 'finished';
    if (key === phase || feedback) return;
    phase = key;

    if (key === 'waiting') {
      box.replaceChildren(
        el('section', { class: 'card live-wait' }, el('div', { class: 'live-rocket', 'aria-hidden': 'true' }, '🚀'), el('h2', {}, '선생님이 시작하면 문제가 나와요'), el('p', { class: 'row-meta' }, '이 화면을 켜 두고 기다려요.')),
      );
      return;
    }
    const correct = [...mine.values()].filter(Boolean).length;
    if (key === 'ended' || key === 'finished') {
      box.replaceChildren(
        el(
          'section',
          { class: 'card live-wait' },
          el('div', { class: 'live-rocket', 'aria-hidden': 'true' }, key === 'finished' ? '🏁' : '⏰'),
          el('h2', {}, key === 'finished' ? '결승선 도착! 다 풀었어요' : '끝났어요'),
          el('p', {}, `${questions?.length ?? 0}문제 중 ${mine.size}문제 답했고, ${correct}문제 맞혔어요.`),
          key === 'finished' && state.status === 'running' ? el('p', { class: 'row-meta' }, '친구들이 끝날 때까지 기다려요.') : null,
        ),
      );
      return;
    }

    // 문제 하나
    const index = questions.indexOf(next);
    const status = el('div');
    const answer = (value) => {
      if (!value) return;
      buttons.forEach((b) => (b.disabled = true));
      withBusy(submit ?? buttons[0], async () => {
        const { data, error } = await supabase.rpc('answer_live', { p_question_id: next.id, p_answer: value });
        if (error) {
          status.replaceChildren(message(error.message.includes('시간') ? '⏰ 시간이 끝났어요.' : error.message, 'error'));
          if (!error.message.includes('이미')) buttons.forEach((b) => (b.disabled = false));
          if (error.message.includes('이미') || error.message.includes('시간') || error.message.includes('풀 수 없')) load();
          return;
        }
        mine.set(next.id, data.correct);
        feedback = el('div', { class: `live-feedback ${data.correct ? 'right' : 'wrong'}` }, data.correct ? '⭕ 맞았어요!' : '❌ 틀렸어요');
        box.replaceChildren(feedback);
        setTimeout(() => {
          feedback = null;
          phase = null;
          render();
        }, 800);
      });
    };
    let submit = null;
    let buttons = [];
    let body;
    if (next.choices) {
      buttons = next.choices.map((choice, c) => el('button', { type: 'button', class: 'live-choice', onclick: () => answer(String(c + 1)) }, `${c + 1}. ${choice}`));
      body = el('div', { class: 'live-choices' }, buttons);
    } else {
      const input = el('input', { maxlength: '200', autocomplete: 'off', placeholder: '답을 써 주세요', 'aria-label': '답' });
      submit = el('button', { type: 'submit' }, '답하기');
      buttons = [submit];
      body = el('form', { class: 'live-short', onsubmit: (e) => { e.preventDefault(); answer(input.value.trim()); } }, input, submit);
      setTimeout(() => input.focus(), 0);
    }
    box.replaceChildren(
      el('div', { class: 'quiz-timer live-timer' }),
      el('div', { class: 'live-progress' }, el('div', { class: 'live-progress-bar', style: `width: ${(index / questions.length) * 100}%` })),
      el('section', { class: 'card question' }, el('div', { class: 'row-meta' }, `${index + 1} / ${questions.length}번 문제`), el('h2', {}, next.question), body, status),
    );
  }

  await load();
  const stop = watch(box, quiz.id, load);
  tick = setInterval(() => {
    if (!box.isConnected) {
      clearInterval(tick);
      stop();
      return;
    }
    const timerEl = box.querySelector('.live-timer');
    if (!state || state.status !== 'running') return;
    const left = clock(state).left();
    if (timerEl) {
      timerEl.textContent = left === null ? '⏱ 제한 시간 없음' : `⏱ 남은 시간 ${mmss(left)}`;
      timerEl.classList.toggle('urgent', left !== null && left <= 10000);
    }
    if (left === 0 && phase !== 'ended') render();
  }, 250);
}
