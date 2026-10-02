import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { realNames, withRealName } from '../realnames.js';
import { fetchRoster, participationPanel } from '../roster.js';
import { displayName, el, errorBox, formatDateTime, loading, message, withBusy } from '../ui.js';

export const title = '퀴즈';

const MAX_QUESTIONS = 20;

// #/quiz        → 퀴즈 목록
// #/quiz/new    → 퀴즈 만들기 (관리자)
// #/quiz/3      → 퀴즈 풀기 / 내 결과 / (관리자) 정답·결과
export function render(view, ctx) {
  const [first] = ctx.params;
  if (!first) return renderList(view, ctx);
  if (first === 'new') return renderBuilder(view, ctx);
  if (!/^\d+$/.test(first)) {
    view.append(message('없는 퀴즈예요.'));
    return;
  }
  return renderQuiz(view, ctx, Number(first));
}

// ---------- 목록 ----------

async function renderList(view, ctx) {
  const admin = isAdmin(ctx.user);
  view.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h1', {}, '퀴즈'),
      el('span', { class: 'spacer' }),
      admin ? el('a', { class: 'button', href: '#/quiz/new' }, '새 퀴즈') : null,
    ),
  );
  const box = el('div', {}, loading());
  view.append(box);

  // 관리자는 모든 답안, 학생은 자기 답안만 읽힘 (RLS)
  const [{ data: quizzes, error }, { data: attempts, error: attemptsError }, { data: roster }] = await Promise.all([
    supabase.from('quizzes').select('id, title, description, is_open, time_limit_sec, created_at').order('created_at', { ascending: false }),
    supabase.from('quiz_attempts').select('quiz_id, user_id, score, total'),
    fetchRoster(),
  ]);
  if (error || attemptsError) {
    box.replaceChildren(errorBox(error ?? attemptsError));
    return;
  }
  if (quizzes.length === 0) {
    box.replaceChildren(message(admin ? '아직 퀴즈가 없어요. "새 퀴즈"로 만들어 보세요.' : '아직 퀴즈가 없어요.'));
    return;
  }

  const studentIds = new Set((roster ?? []).map((s) => s.id));
  const item = (quiz) => {
    const mine = attempts.find((a) => a.quiz_id === quiz.id && a.user_id === ctx.user.id);
    let badge;
    if (admin) {
      const n = attempts.filter((a) => a.quiz_id === quiz.id && studentIds.has(a.user_id)).length;
      badge = el('span', { class: 'badge later' }, `참여 ${n} / ${studentIds.size}`);
    } else if (mine) {
      badge = el('span', { class: 'badge later' }, `완료 ${mine.score}/${mine.total}`);
    } else {
      badge = el('span', { class: `badge ${quiz.is_open ? 'today' : ''}` }, quiz.is_open ? '아직 안 풂' : '닫힘');
    }
    return el(
      'li',
      {},
      el(
        'a',
        { class: 'row-link', href: `#/quiz/${quiz.id}` },
        el('div', { class: 'item-head' }, badge, el('span', { class: 'row-title' }, quiz.title), quiz.time_limit_sec ? el('span', { class: 'badge soon' }, `⏱ ${formatLimit(quiz.time_limit_sec)}`) : null, quiz.is_open ? null : el('span', { class: 'badge' }, '닫힘')),
        quiz.description ? el('div', { class: 'row-meta preview' }, quiz.description) : null,
        el('div', { class: 'row-meta' }, formatDateTime(quiz.created_at)),
      ),
    );
  };
  box.replaceChildren(el('ul', { class: 'list' }, quizzes.map(item)));
}

// ---------- 만들기 (관리자) ----------

function questionEditor(index, onRemove) {
  const n = () => Number(block.dataset.index) + 1;
  const questionInput = el('textarea', { class: 'q-text', maxlength: '500', rows: '2', required: true, placeholder: '문제' });
  const typeSelect = el('select', { class: 'q-type' }, el('option', { value: 'choice' }, '객관식'), el('option', { value: 'short' }, '주관식'));
  const choicesInput = el('textarea', { class: 'q-choices', rows: '4', placeholder: '보기를 한 줄에 하나씩 (2~5개)' });
  const correctSelect = el('select', { class: 'q-correct' });
  const answerInput = el('input', { class: 'q-answer', maxlength: '200', placeholder: '정답 (여러 개면 | 로 구분, 예: 서울|서울특별시)' });
  const choiceArea = el('div', {}, el('label', {}, '보기'), choicesInput, el('label', {}, '정답 보기 번호'), correctSelect);
  const shortArea = el('div', { hidden: true }, el('label', {}, '정답'), answerInput, el('p', { class: 'row-meta' }, '띄어쓰기와 영어 대소문자는 달라도 정답으로 처리해요.'));

  const refreshCorrect = () => {
    const count = choicesInput.value.split('\n').filter((line) => line.trim()).length;
    const keep = correctSelect.value;
    correctSelect.replaceChildren(...Array.from({ length: Math.max(count, 0) }, (_, i) => el('option', { value: String(i + 1) }, `${i + 1}번`)));
    if (keep && Number(keep) <= count) correctSelect.value = keep;
  };
  choicesInput.addEventListener('input', refreshCorrect);
  typeSelect.addEventListener('change', () => {
    choiceArea.hidden = typeSelect.value !== 'choice';
    shortArea.hidden = typeSelect.value === 'choice';
  });

  const heading = el('h3', {});
  const block = el(
    'fieldset',
    { class: 'card question-editor' },
    el('div', { class: 'item-head' }, heading, el('span', { class: 'spacer' }), typeSelect, el('button', { type: 'button', class: 'danger small', onclick: () => onRemove(block) }, '문제 빼기')),
    questionInput,
    choiceArea,
    shortArea,
  );
  block.dataset.index = String(index);
  block.renumber = () => {
    heading.textContent = `${n()}번 문제`;
  };
  block.renumber();
  block.read = () => {
    const question = questionInput.value.trim();
    if (!question) throw new Error(`${n()}번 문제를 써 주세요.`);
    if (typeSelect.value === 'choice') {
      const choices = choicesInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
      if (choices.length < 2 || choices.length > 5) throw new Error(`${n()}번 문제의 보기는 2~5개여야 해요.`);
      if (choices.some((c) => c.length > 200)) throw new Error(`${n()}번 문제의 보기가 너무 길어요.`);
      if (!correctSelect.value) throw new Error(`${n()}번 문제의 정답 번호를 골라 주세요.`);
      return { question, choices, answer: correctSelect.value };
    }
    const answer = answerInput.value.trim();
    if (!answer) throw new Error(`${n()}번 문제의 정답을 써 주세요.`);
    return { question, choices: null, answer };
  };
  return block;
}

function renderBuilder(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 퀴즈를 만들 수 있어요.', 'error'));
    return;
  }
  const titleInput = el('input', { id: 'quiz-title', maxlength: '50', required: true, placeholder: '예: 3단원 확인 퀴즈' });
  const descInput = el('textarea', { id: 'quiz-desc', maxlength: '500', rows: '2', placeholder: '설명 (선택)' });
  const limitSelect = el(
    'select',
    { id: 'quiz-limit' },
    [0, 30, 60, 120, 180, 300, 600, 900, 1200, 1800].map((sec) => el('option', { value: String(sec) }, sec ? formatLimit(sec) : '제한 시간 없음')),
  );
  const questions = el('div', { class: 'questions' });
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '퀴즈 만들기');

  const renumber = () => [...questions.children].forEach((block, i) => {
    block.dataset.index = String(i);
    block.renumber();
  });
  const addQuestion = () => {
    if (questions.children.length >= MAX_QUESTIONS) {
      status.replaceChildren(message(`문제는 ${MAX_QUESTIONS}개까지 만들 수 있어요.`, 'error'));
      return;
    }
    questions.append(questionEditor(questions.children.length, (block) => {
      if (questions.children.length === 1) return;
      block.remove();
      renumber();
    }));
  };
  addQuestion();

  const form = el(
    'form',
    {},
    el('div', { class: 'card' }, el('label', { for: 'quiz-title' }, '퀴즈 제목'), titleInput, el('label', { for: 'quiz-desc' }, '설명'), descInput, el('label', { for: 'quiz-limit' }, '제한 시간'), limitSelect),
    questions,
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'secondary', onclick: addQuestion }, '+ 문제 추가')),
    status,
    el('div', { class: 'actions' }, submit, el('a', { href: '#/quiz', class: 'muted' }, '취소')),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let items;
    try {
      if (!titleInput.value.trim()) throw new Error('퀴즈 제목을 써 주세요.');
      items = [...questions.children].map((block) => block.read());
    } catch (error) {
      status.replaceChildren(message(error.message, 'error'));
      return;
    }
    withBusy(submit, async () => {
      status.replaceChildren(message('만드는 중…'));
      const { data: quizRows, error } = await supabase
        .from('quizzes')
        .insert({ title: titleInput.value.trim(), description: descInput.value.trim() || null, time_limit_sec: Number(limitSelect.value) || null })
        .select('id');
      if (error || !quizRows?.length) return status.replaceChildren(error ? errorBox(error) : message('만들 권한이 없어요.', 'error'));
      const quizId = quizRows[0].id;

      const fail = async (failError) => {
        await supabase.from('quizzes').delete().eq('id', quizId); // 반쯤 만들어진 퀴즈는 지움
        status.replaceChildren(errorBox(failError));
      };
      const { data: rows, error: qError } = await supabase
        .from('quiz_questions')
        .insert(items.map((item, i) => ({ quiz_id: quizId, position: i + 1, question: item.question, choices: item.choices })))
        .select('id, position');
      if (qError) return fail(qError);
      const idByPosition = new Map(rows.map((row) => [row.position, row.id]));
      const { error: kError } = await supabase
        .from('quiz_keys')
        .insert(items.map((item, i) => ({ question_id: idByPosition.get(i + 1), answer: item.answer })));
      if (kError) return fail(kError);
      location.hash = `#/quiz/${quizId}`;
    });
  });

  view.append(el('h1', {}, '새 퀴즈'), form);
  titleInput.focus();
}

// ---------- 풀기 / 결과 ----------

// 걸린 시간: 72300 → "1분 12.3초"
export function formatElapsed(ms) {
  if (ms == null) return '-';
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec - min * 60).toFixed(1).replace(/\.0$/, '');
  return min ? `${min}분 ${sec}초` : `${sec}초`;
}

export function formatLimit(sec) {
  if (!sec) return '제한 시간 없음';
  return sec % 60 ? `${Math.floor(sec / 60) ? `${Math.floor(sec / 60)}분 ` : ''}${sec % 60}초` : `${sec / 60}분`;
}

function answerText(question, value) {
  if (value == null || value === '') return '(빈칸)';
  if (question.choices) return `${value}번 ${question.choices[Number(value) - 1] ?? ''}`;
  return value;
}

function resultList(questions, given, keys) {
  return el(
    'ol',
    { class: 'quiz-review' },
    questions.map((q) => {
      const key = keys.get(q.id) ?? '';
      const mine = given[q.id] ?? '';
      const accepted = key.split('|').map((a) => a.replace(/\s/g, '').toLowerCase());
      const ok = mine !== '' && accepted.includes(String(mine).replace(/\s/g, '').toLowerCase());
      return el(
        'li',
        { class: ok ? 'right' : 'wrong' },
        el('div', { class: 'row-title' }, `${ok ? '⭕' : '❌'} ${q.question}`),
        el('div', {}, `내 답: ${answerText(q, mine)}`),
        ok ? null : el('div', { class: 'row-meta' }, `정답: ${q.choices ? answerText(q, key) : key.split('|').join(' 또는 ')}`),
      );
    }),
  );
}

// ⚡ 빨리 푼 순위 (만점자만, 걸린 시간 순) — 모두에게 보임
async function speedSection(ctx, quizId, roster, names) {
  const { data, error } = await supabase.rpc('quiz_speed_ranking', { p_quiz_id: quizId });
  if (error) return errorBox(error);
  const byId = new Map(roster.map((s) => [s.id, s]));
  const rows = data.filter((row) => byId.has(row.user_id)).slice(0, 10);
  return el(
    'section',
    { class: 'card speed' },
    el('h2', {}, '⚡ 빨리 푼 순위 (만점자)'),
    rows.length
      ? el(
          'ol',
          { class: 'speed-list' },
          rows.map((row, i) =>
            el(
              'li',
              { class: row.user_id === ctx.user.id ? 'me' : null },
              el('span', { class: 'speed-rank' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`),
              el('span', { class: 'speed-name' }, withRealName(displayName(byId.get(row.user_id)), row.user_id, names)),
              el('span', { class: 'speed-time' }, formatElapsed(row.elapsed_ms)),
            ),
          ),
        )
      : message('아직 만점자가 없어요.'),
  );
}

async function renderQuiz(view, ctx, id) {
  const admin = isAdmin(ctx.user);
  view.append(loading());

  const [{ data: quiz, error }, { data: mine }, { data: started }, { data: roster }, names] = await Promise.all([
    supabase.from('quizzes').select('id, title, description, is_open, time_limit_sec, created_at').eq('id', id).maybeSingle(),
    supabase.from('quiz_attempts').select('answers, score, total, elapsed_ms, created_at').eq('quiz_id', id).eq('user_id', ctx.user.id).maybeSingle(),
    supabase.from('quiz_starts').select('started_at').eq('quiz_id', id).eq('user_id', ctx.user.id).maybeSingle(),
    fetchRoster(),
    realNames(ctx.user),
  ]);
  if (error) {
    view.replaceChildren(errorBox(error));
    return;
  }
  if (!quiz) {
    view.replaceChildren(message('없는 퀴즈예요.'), el('a', { href: '#/quiz' }, '퀴즈 목록으로'));
    return;
  }
  const students = roster ?? [];

  const header = el(
    'section',
    { class: 'card' },
    el('div', { class: 'item-head' }, el('h1', {}, quiz.title), quiz.is_open ? null : el('span', { class: 'badge' }, '닫힘')),
    quiz.description ? el('p', { class: 'body-text' }, quiz.description) : null,
    el('div', { class: 'row-meta' }, `⏱ ${formatLimit(quiz.time_limit_sec)}`),
  );
  const parts = [el('a', { href: '#/quiz' }, '← 퀴즈 목록'), header];

  if (admin) {
    // 관리자는 시작하지 않아도 문제를 읽을 수 있음 (RLS)
    const { data: questions, error: qError } = await supabase.from('quiz_questions').select('id, position, question, choices').eq('quiz_id', id).order('position').order('id');
    if (qError) return view.replaceChildren(errorBox(qError));
    parts.push(...(await adminView(ctx, quiz, questions, students, names)));
    parts.splice(5, 0, await speedSection(ctx, id, students, names)); // 참가 현황 다음
    view.replaceChildren(...parts);
    return;
  }

  const { data: participation } = await supabase.rpc('quiz_participation', { p_quiz_id: id });
  const done = new Map((participation ?? []).map((row) => [row.user_id, '']));

  if (mine) {
    // 이미 냄: 내 결과 (문제는 시작했으니 읽힘)
    const [{ data: questions }, { data: keyRows }] = await Promise.all([
      supabase.from('quiz_questions').select('id, position, question, choices').eq('quiz_id', id).order('position').order('id'),
      supabase.rpc('quiz_review', { p_quiz_id: id }),
    ]);
    const keys = new Map((keyRows ?? []).map((row) => [row.question_id, row.answer]));
    parts.push(
      el(
        'section',
        { class: 'card' },
        el('h2', {}, `내 점수: ${mine.score} / ${mine.total}`),
        el('p', { class: 'row-meta' }, `걸린 시간: ${formatElapsed(mine.elapsed_ms)} · 제출: ${formatDateTime(mine.created_at)}`),
        resultList(questions ?? [], mine.answers, keys),
      ),
    );
  } else if (!quiz.is_open) {
    parts.push(message('닫힌 퀴즈예요. 이제 참여할 수 없어요.', 'warn'));
  } else if (started) {
    // 시작해 놓고 나갔다 다시 들어옴 → 남은 시간 그대로 이어서
    parts.push(await quizPlay(ctx, quiz));
  } else {
    const startButton = el('button', { type: 'button', class: 'big' }, '시작하기');
    const status = el('div');
    startButton.addEventListener('click', () =>
      withBusy(startButton, async () => {
        const play = await quizPlay(ctx, quiz);
        if (play.dataset.failed) return status.replaceChildren(play);
        startCard.replaceWith(play);
      }),
    );
    const startCard = el(
      'section',
      { class: 'card quiz-start' },
      el('h2', {}, quiz.time_limit_sec ? `⏱ 제한 시간 ${formatLimit(quiz.time_limit_sec)}` : '제한 시간 없음'),
      el('p', {}, '시작을 누르면 문제가 보이고 시간이 재져요. 빨리, 정확하게 풀수록 "빨리 푼 순위"에 올라가요.'),
      quiz.time_limit_sec ? el('p', { class: 'row-meta' }, '시간이 다 되면 자동으로 제출돼요. 한 번만 풀 수 있어요.') : el('p', { class: 'row-meta' }, '한 번만 풀 수 있어요.'),
      el('div', { class: 'actions' }, startButton),
      status,
    );
    parts.push(startCard);
  }
  parts.push(await speedSection(ctx, id, students, names));
  parts.push(participationPanel(students, done, names));
  view.replaceChildren(...parts);
}

// 시작(또는 이어 하기) → 문제와 타이머
async function quizPlay(ctx, quiz) {
  const { data: start, error } = await supabase.rpc('start_quiz', { p_quiz_id: quiz.id });
  if (error) {
    const box = message(error.message.includes('이미') ? '이미 참여한 퀴즈예요.' : error.message.includes('닫혔') ? '닫힌 퀴즈예요.' : `시작하지 못했어요: ${error.message}`, 'error');
    box.dataset.failed = '1';
    return box;
  }
  const { data: questions, error: qError } = await supabase.from('quiz_questions').select('id, position, question, choices').eq('quiz_id', quiz.id).order('position').order('id');
  if (qError) return errorBox(qError);

  // 서버 시각 기준으로 남은 시간 계산 (기기 시계가 틀려도 공정하게)
  const offset = new Date(start.server_now).getTime() - Date.now();
  const deadline = start.time_limit_sec ? new Date(start.started_at).getTime() + start.time_limit_sec * 1000 : null;
  return quizForm(ctx, quiz, questions, deadline, offset, new Date(start.started_at).getTime());
}

function quizForm(ctx, quiz, questions, deadline, offset, startedAt) {
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '제출하기');
  const timer = el('div', { class: 'quiz-timer', role: 'timer', 'aria-live': 'off' });
  const fields = questions.map((q, i) => {
    const name = `q-${q.id}`;
    const body = q.choices
      ? el(
          'div',
          { class: 'choices', role: 'radiogroup' },
          q.choices.map((choice, c) =>
            el('label', { class: 'choice' }, el('input', { type: 'radio', name, value: String(c + 1) }), ` ${c + 1}. `, choice),
          ),
        )
      : el('input', { name, maxlength: '200', autocomplete: 'off', placeholder: '답을 써 주세요' });
    return el('fieldset', { class: 'card question' }, el('legend', {}, `${i + 1}. `, q.question), body);
  });

  const form = el('form', { class: 'quiz-play' }, timer, ...fields, status, el('div', { class: 'actions' }, submit));
  let sent = false;
  let tick = null;

  const collect = () => {
    const answers = {};
    let empty = 0;
    for (const q of questions) {
      const name = `q-${q.id}`;
      const value = q.choices ? form.querySelector(`input[name="${name}"]:checked`)?.value ?? '' : form.elements[name].value.trim();
      if (!value) empty += 1;
      answers[q.id] = value;
    }
    return { answers, empty };
  };

  async function send(auto) {
    if (sent) return;
    sent = true;
    clearInterval(tick);
    submit.disabled = true;
    status.replaceChildren(message(auto ? '⏰ 시간이 다 되어 자동으로 제출하는 중…' : '제출하는 중…'));
    const { error } = await supabase.rpc('submit_quiz', { p_quiz_id: quiz.id, p_answers: collect().answers });
    if (error) {
      const text = error.message.includes('제한 시간')
        ? '제한 시간이 지나서 제출되지 않았어요. 선생님께 말씀해 주세요.'
        : error.message.includes('이미')
          ? '이미 참여한 퀴즈예요.'
          : error.message.includes('닫혔')
            ? '닫힌 퀴즈예요.'
            : `제출하지 못했어요: ${error.message}`;
      status.replaceChildren(message(text, 'error'));
      if (!error.message.includes('제한 시간')) {
        sent = false;
        submit.disabled = false;
      }
      return;
    }
    ctx.refresh();
  }

  // 타이머: 제한 시간이 있으면 남은 시간, 없으면 지난 시간
  const update = () => {
    if (!form.isConnected && sent) return clearInterval(tick);
    const now = Date.now() + offset;
    if (deadline) {
      const left = Math.max(0, deadline - now);
      const sec = Math.ceil(left / 1000);
      timer.textContent = `⏱ 남은 시간 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      timer.classList.toggle('urgent', sec <= 10);
      if (left <= 0) send(true);
    } else {
      const sec = Math.floor((now - startedAt) / 1000);
      timer.textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    }
  };
  update();
  tick = setInterval(() => {
    if (!form.isConnected) {
      clearInterval(tick);
      return;
    }
    update();
  }, 250);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { empty } = collect();
    const ask = empty ? `아직 안 푼 문제가 ${empty}개 있어요. 그래도 제출할까요?\n제출하면 다시 풀 수 없어요.` : '제출할까요? 제출하면 다시 풀 수 없어요.';
    if (!confirm(ask)) return;
    send(false);
  });
  return form;
}

// 관리자: 정답이 표시된 문제, 학생별 점수·시간과 참가 현황, 열기/닫기/삭제, 다시 풀게 하기
async function adminView(ctx, quiz, questions, roster, names) {
  const [{ data: keyRows }, { data: attempts, error }] = await Promise.all([
    supabase.from('quiz_keys').select('question_id, answer').in('question_id', questions.map((q) => q.id)),
    supabase.from('quiz_attempts').select('id, user_id, score, total, elapsed_ms, created_at').eq('quiz_id', quiz.id),
  ]);
  if (error) return [errorBox(error)];
  const keys = new Map((keyRows ?? []).map((row) => [row.question_id, row.answer]));
  const done = new Map(attempts.map((a) => [a.user_id, `${a.score}/${a.total}점`]));
  const status = el('div');

  const toggle = el('button', { type: 'button', class: 'secondary' }, quiz.is_open ? '퀴즈 닫기' : '다시 열기');
  toggle.addEventListener('click', () =>
    withBusy(toggle, async () => {
      const { error: e } = await supabase.from('quizzes').update({ is_open: !quiz.is_open }).eq('id', quiz.id);
      if (e) return status.replaceChildren(errorBox(e));
      ctx.refresh();
    }),
  );
  const remove = el('button', { type: 'button', class: 'danger' }, '퀴즈 삭제');
  remove.addEventListener('click', () => {
    if (!confirm('이 퀴즈와 모든 학생 답안을 삭제할까요? 되돌릴 수 없어요.')) return;
    withBusy(remove, async () => {
      const { error: e } = await supabase.from('quizzes').delete().eq('id', quiz.id);
      if (e) return status.replaceChildren(errorBox(e));
      location.hash = '#/quiz';
    });
  });

  const byUser = new Map(roster.map((s) => [s.id, s]));
  const average = attempts.length ? (attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length).toFixed(1) : '-';
  // 점수 높은 순, 같으면 빨리 푼 순
  const sorted = [...attempts].sort((a, b) => b.score - a.score || (a.elapsed_ms ?? Infinity) - (b.elapsed_ms ?? Infinity));
  const results = el(
    'section',
    { class: 'card' },
    el('h2', {}, `학생별 결과 (평균 ${average} / ${questions.length})`),
    attempts.length
      ? el(
          'ul',
          { class: 'list compact' },
          sorted.map((a, i) => {
            const retry = el('button', { type: 'button', class: 'secondary small' }, '다시 풀게 하기');
            retry.addEventListener('click', () => {
              if (!confirm('이 학생의 답안과 시작 기록을 지우고 다시 풀게 할까요?')) return;
              withBusy(retry, async () => {
                const { error: e } = await supabase.from('quiz_attempts').delete().eq('id', a.id);
                if (e) return status.replaceChildren(errorBox(e));
                const { error: e2 } = await supabase.from('quiz_starts').delete().eq('quiz_id', quiz.id).eq('user_id', a.user_id);
                if (e2) return status.replaceChildren(errorBox(e2));
                ctx.refresh();
              });
            });
            const student = byUser.get(a.user_id);
            return el(
              'li',
              { class: 'item-head' },
              el('span', { class: 'row-meta' }, `${i + 1}.`),
              el('strong', {}, student ? withRealName(displayName(student), a.user_id, names) : '(선생님 또는 지운 계정)'),
              el('span', {}, `${a.score} / ${a.total}`),
              el('span', { class: 'row-meta' }, `⏱ ${formatElapsed(a.elapsed_ms)}`),
              el('span', { class: 'spacer' }),
              retry,
            );
          }),
        )
      : message('아직 제출한 학생이 없어요.'),
  );

  const answerKey = el(
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
          el('div', { class: 'row-meta' }, `정답: ${q.choices ? answerText(q, key) : key.split('|').join(' 또는 ')}`),
        );
      }),
    ),
  );

  return [
    el('div', { class: 'actions' }, toggle, remove),
    status,
    participationPanel(roster, done, names),
    results,
    answerKey,
  ];
}
