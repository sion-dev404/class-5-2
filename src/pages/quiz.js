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
    supabase.from('quizzes').select('id, title, description, is_open, created_at').order('created_at', { ascending: false }),
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
        el('div', { class: 'item-head' }, badge, el('span', { class: 'row-title' }, quiz.title), quiz.is_open ? null : el('span', { class: 'badge' }, '닫힘')),
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
    el('div', { class: 'card' }, el('label', { for: 'quiz-title' }, '퀴즈 제목'), titleInput, el('label', { for: 'quiz-desc' }, '설명'), descInput),
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
        .insert({ title: titleInput.value.trim(), description: descInput.value.trim() || null })
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

async function renderQuiz(view, ctx, id) {
  const admin = isAdmin(ctx.user);
  view.append(loading());

  const [{ data: quiz, error }, { data: questions, error: qError }, { data: mine }, { data: roster }, names] = await Promise.all([
    supabase.from('quizzes').select('id, title, description, is_open, created_at').eq('id', id).maybeSingle(),
    supabase.from('quiz_questions').select('id, position, question, choices').eq('quiz_id', id).order('position').order('id'),
    supabase.from('quiz_attempts').select('answers, score, total, created_at').eq('quiz_id', id).eq('user_id', ctx.user.id).maybeSingle(),
    fetchRoster(),
    realNames(ctx.user),
  ]);
  if (error || qError) {
    view.replaceChildren(errorBox(error ?? qError));
    return;
  }
  if (!quiz) {
    view.replaceChildren(message('없는 퀴즈예요.'), el('a', { href: '#/quiz' }, '퀴즈 목록으로'));
    return;
  }

  const header = el(
    'section',
    { class: 'card' },
    el('div', { class: 'item-head' }, el('h1', {}, quiz.title), quiz.is_open ? null : el('span', { class: 'badge' }, '닫힘')),
    quiz.description ? el('p', { class: 'body-text' }, quiz.description) : null,
    el('div', { class: 'row-meta' }, `문제 ${questions.length}개`),
  );
  const parts = [el('a', { href: '#/quiz' }, '← 퀴즈 목록'), header];

  if (admin) {
    parts.push(...(await adminView(ctx, quiz, questions, roster ?? [], names)));
  } else {
    // 참가 현황 (누가 냈는지만, 점수는 안 보임)
    const { data: participation } = await supabase.rpc('quiz_participation', { p_quiz_id: id });
    const done = new Map((participation ?? []).map((row) => [row.user_id, '']));
    if (mine) {
      const { data: keyRows } = await supabase.rpc('quiz_review', { p_quiz_id: id });
      const keys = new Map((keyRows ?? []).map((row) => [row.question_id, row.answer]));
      parts.push(
        el(
          'section',
          { class: 'card' },
          el('h2', {}, `내 점수: ${mine.score} / ${mine.total}`),
          el('p', { class: 'row-meta' }, `제출: ${formatDateTime(mine.created_at)}`),
          resultList(questions, mine.answers, keys),
        ),
      );
    } else if (quiz.is_open) {
      parts.push(quizForm(ctx, quiz, questions));
    } else {
      parts.push(message('닫힌 퀴즈예요. 이제 참여할 수 없어요.', 'warn'));
    }
    parts.push(participationPanel(roster ?? [], done, names));
  }
  view.replaceChildren(...parts);
}

function quizForm(ctx, quiz, questions) {
  const status = el('div');
  const submit = el('button', { type: 'submit' }, '제출하기');
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

  const form = el('form', {}, ...fields, status, el('div', { class: 'actions' }, submit));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const answers = {};
    let empty = 0;
    for (const q of questions) {
      const name = `q-${q.id}`;
      const value = q.choices ? form.querySelector(`input[name="${name}"]:checked`)?.value ?? '' : form.elements[name].value.trim();
      if (!value) empty += 1;
      answers[q.id] = value;
    }
    const ask = empty ? `아직 안 푼 문제가 ${empty}개 있어요. 그래도 제출할까요?\n제출하면 다시 풀 수 없어요.` : '제출할까요? 제출하면 다시 풀 수 없어요.';
    if (!confirm(ask)) return;
    withBusy(submit, async () => {
      const { error } = await supabase.rpc('submit_quiz', { p_quiz_id: quiz.id, p_answers: answers });
      if (error) {
        status.replaceChildren(message(error.message.includes('이미') ? '이미 참여한 퀴즈예요.' : error.message.includes('닫혔') ? '닫힌 퀴즈예요.' : `제출하지 못했어요: ${error.message}`, 'error'));
        return;
      }
      ctx.refresh();
    });
  });
  return form;
}

// 관리자: 정답이 표시된 문제, 학생별 점수와 참가 현황, 열기/닫기/삭제, 다시 풀게 하기
async function adminView(ctx, quiz, questions, roster, names) {
  const [{ data: keyRows }, { data: attempts, error }] = await Promise.all([
    supabase.from('quiz_keys').select('question_id, answer').in('question_id', questions.map((q) => q.id)),
    supabase.from('quiz_attempts').select('id, user_id, score, total, created_at').eq('quiz_id', quiz.id),
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
  const results = el(
    'section',
    { class: 'card' },
    el('h2', {}, `학생별 결과 (평균 ${average} / ${questions.length})`),
    attempts.length
      ? el(
          'ul',
          { class: 'list compact' },
          [...attempts]
            .sort((a, b) => (byUser.get(a.user_id)?.username ?? '').localeCompare(byUser.get(b.user_id)?.username ?? ''))
            .map((a) => {
              const retry = el('button', { type: 'button', class: 'secondary small' }, '다시 풀게 하기');
              retry.addEventListener('click', () => {
                if (!confirm('이 학생의 답안을 지우고 다시 풀게 할까요?')) return;
                withBusy(retry, async () => {
                  const { error: e } = await supabase.from('quiz_attempts').delete().eq('id', a.id);
                  if (e) return status.replaceChildren(errorBox(e));
                  ctx.refresh();
                });
              });
              const student = byUser.get(a.user_id);
              return el(
                'li',
                { class: 'item-head' },
                el('strong', {}, student ? withRealName(displayName(student), a.user_id, names) : '(선생님 또는 지운 계정)'),
                el('span', {}, `${a.score} / ${a.total}`),
                el('span', { class: 'row-meta' }, formatDateTime(a.created_at)),
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
    el('h2', {}, '문제와 정답 (선생님만 보여요)'),
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
