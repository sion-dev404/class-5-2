import { supabase } from './supabase.js';
import { displayName, el, message } from './ui.js';
import { withRealName } from './realnames.js';

// 우리 반 학생 명단 (role = student 인 계정 전체, 아이디 순서). 계정을 만들거나 지우면 자동 반영
export function fetchRoster() {
  return supabase.from('profiles').select('id, username, nickname').eq('role', 'student').order('username');
}

// 참가 현황 칸
//   roster : 학생 명단
//   done   : Map(user_id → 덧붙일 글자, 예: "글 2개", "8/10점")
//   names  : 실명 Map (관리자만 내용 있음)
export function participationPanel(roster, done, names, heading = '참가 현황') {
  if (!roster.length) return message('학생 명단을 불러오지 못했어요.');
  const doneCount = roster.filter((student) => done.has(student.id)).length;
  const chip = (student) => {
    const isDone = done.has(student.id);
    const detail = done.get(student.id);
    return el(
      'li',
      { class: `chip ${isDone ? 'done' : 'todo'}`, title: isDone ? '참여' : '아직' },
      `${isDone ? '✅' : '⬜'} ${withRealName(displayName(student), student.id, names)}`,
      detail ? el('span', { class: 'chip-detail' }, ` ${detail}`) : null,
    );
  };
  return el(
    'section',
    { class: 'card participation' },
    el('h2', {}, `${heading} `, el('span', { class: 'badge later' }, `참여 ${doneCount} / ${roster.length}`)),
    el(
      'div',
      { class: 'progress', role: 'img', 'aria-label': `참여 ${doneCount}명, 전체 ${roster.length}명` },
      el('div', { class: 'progress-bar', style: `width: ${Math.round((doneCount / roster.length) * 100)}%` }),
    ),
    el('ul', { class: 'chips' }, roster.map(chip)),
  );
}
