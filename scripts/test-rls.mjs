// RLS 보안 규칙 실험 : 실제 Supabase 없이, 컴퓨터 안의 작은 Postgres(PGlite)로
// supabase/schema.sql 을 실행하고 '학생이 남의 글 지우기' 같은 시도가 막히는지 확인합니다.
// 실행: npm run test:rls

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const makeAdmin = readFileSync(new URL('../supabase/make-admin.sql', import.meta.url), 'utf8');

// Supabase 흉내: 역할, auth 스키마, auth.uid()
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase 기본값처럼 새 테이블에 넓은 권한을 주는 상태를 재현
  alter default privileges in schema public grant all on tables to anon, authenticated;
  -- Supabase Storage 흉내
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  alter table storage.objects enable row level security;
`);

// 스키마보다 먼저 만든 계정 (백필 확인용)
await db.exec(`insert into auth.users (email) values ('early@class52.local');`);
await db.exec(schema);
await db.exec(schema); // 두 번 실행해도 되는지
await db.exec(`insert into auth.users (email) values
  ('redsionkim@class52.local'), ('s01@class52.local'), ('s02@class52.local');`);
await db.exec(makeAdmin);

const ids = Object.fromEntries(
  (await db.query(`select username, id from public.profiles`)).rows.map((r) => [r.username, r.id]),
);

let pass = 0, fail = 0;
async function as(user, sql) {
  await db.exec('reset role');
  if (user === 'anon') {
    await db.exec(`set request.jwt.claim.sub = ''; set role anon;`);
  } else {
    await db.exec(`set request.jwt.claim.sub = '${ids[user]}'; set role authenticated;`);
  }
  try {
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('reset role');
  }
}
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`);
}

let r;
check('백필: 먼저 만든 계정도 profiles 있음', !!ids.early);
r = await db.query(`select role from public.profiles where username='redsionkim'`);
check('redsionkim = admin', r.rows[0].role === 'admin');

r = await as('anon', `select * from public.posts`);
check('비로그인: posts 읽기 거부', !!r.error, r);
r = await as('anon', `select * from public.profiles`);
check('비로그인: profiles 읽기 거부', !!r.error, r);

r = await as('s01', `insert into public.posts (title, content) values ('s01 글', '안녕') returning id, author_id`);
check('s01: 글쓰기', !r.error && r.rows[0].author_id === ids.s01, r);
const postId = r.rows[0].id;

r = await as('s01', `insert into public.posts (title, content, author_id) values ('사칭', 'x', '${ids.s02}')`);
check('s01: 남의 이름으로 글쓰기 거부', !!r.error, r);

r = await as('s02', `select id from public.posts`);
check('s02: 남의 글 읽기 가능', r.rows?.length === 1, r);

r = await as('s02', `update public.posts set title='해킹' where id=${postId}`);
check('s02: 남의 글 수정 0건', !r.error && r.affected === 0, r);

r = await as('s02', `delete from public.posts where id=${postId}`);
check('s02: 남의 글 삭제 0건', !r.error && r.affected === 0, r);

r = await as('s01', `update public.posts set author_id='${ids.s02}' where id=${postId}`);
check('s01: 글쓴이 바꾸기 거부', !!r.error, r);

r = await as('s01', `update public.posts set title='고친 제목' where id=${postId} returning updated_at > created_at as changed`);
check('s01: 내 글 수정', !r.error && r.affected === 1, r);

r = await as('s02', `update public.profiles set role='admin' where id='${ids.s02}'`);
check('s02: 스스로 관리자 되기 거부', !!r.error, r);

r = await as('s02', `update public.profiles set nickname='별' where id='${ids.s02}'`);
check('s02: 내 별명 바꾸기', !r.error && r.affected === 1, r);

r = await as('s02', `update public.profiles set nickname='장난' where id='${ids.s01}'`);
check('s02: 남의 별명 바꾸기 0건', !r.error && r.affected === 0, r);

r = await as('s01', `insert into public.lessons (lesson_date, subject, content) values ('2026-10-01','국어','x')`);
check('s01: 수업 쓰기 거부', !!r.error, r);
r = await as('s01', `insert into public.homework (title, due_date) values ('x','2026-10-01')`);
check('s01: 숙제 쓰기 거부', !!r.error, r);

r = await as('redsionkim', `insert into public.lessons (lesson_date, period, subject, content) values ('2026-10-01', 1, '국어','시 읽기') returning id`);
check('관리자: 수업 쓰기', !r.error, r);
const lessonId = r.rows?.[0]?.id;
r = await as('redsionkim', `insert into public.homework (title, due_date) values ('수학익힘 30쪽','2026-10-02')`);
check('관리자: 숙제 쓰기', !r.error, r);

r = await as('s01', `select * from public.lessons`);
check('s01: 수업 읽기', r.rows?.length === 1, r);
r = await as('s01', `delete from public.lessons where id=${lessonId}`);
check('s01: 수업 삭제 0건', !r.error && r.affected === 0, r);
r = await as('s01', `update public.lessons set subject='수학' where id=${lessonId}`);
check('s01: 수업 수정 0건', !r.error && r.affected === 0, r);

r = await as('s01', `insert into public.meals (meal_date, menu) values ('2026-10-01', '짜장면')`);
check('s01: 급식 쓰기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.meals (meal_date, menu) values ('2026-10-01', '쌀밥\n미역국') returning id`);
check('관리자: 급식 쓰기', !r.error, r);
r = await as('redsionkim', `insert into public.meals (meal_date, menu) values ('2026-10-01', '두 번째')`);
check('급식: 같은 날짜 두 번 거부', !!r.error, r);
r = await as('s01', `select menu from public.meals`);
check('s01: 급식 읽기', r.rows?.length === 1, r);
r = await as('s01', `update public.meals set menu='피자'`);
check('s01: 급식 수정 0건', !r.error && r.affected === 0, r);
r = await as('s01', `delete from public.meals`);
check('s01: 급식 삭제 0건', !r.error && r.affected === 0, r);
r = await as('anon', `select * from public.meals`);
check('비로그인: 급식 읽기 거부', !!r.error, r);

r = await as('redsionkim', `delete from public.posts where id=${postId}`);
check('관리자: 학생 글 삭제', !r.error && r.affected === 1, r);

r = await as('s01', `insert into public.posts (title, content) values ('내 글', '곧 지움') returning id`);
r = await as('s01', `delete from public.posts where id=${r.rows[0].id}`);
check('s01: 내 글 삭제', !r.error && r.affected === 1, r);

r = await as('s01', `select public.is_admin() as a`);
check('s01: is_admin() = false', r.rows?.[0]?.a === false, r);

// ---- 댓글 ----
r = await as('s01', `insert into public.posts (title, content) values ('댓글 글', '댓글 달아 줘') returning id`);
const cPost = r.rows[0].id;
r = await as('s02', `insert into public.comments (post_id, content) values (${cPost}, '좋아요!') returning id, author_id`);
check('s02: 남의 글에 댓글', !r.error && r.rows[0].author_id === ids.s02, r);
const cId = r.rows[0].id;
r = await as('s02', `insert into public.comments (post_id, content, author_id) values (${cPost}, '사칭', '${ids.s01}')`);
check('s02: 남의 이름으로 댓글 거부', !!r.error, r);
r = await as('s01', `select content from public.comments where post_id=${cPost}`);
check('s01: 댓글 읽기', r.rows?.length === 1, r);
r = await as('anon', `select * from public.comments`);
check('비로그인: 댓글 거부', !!r.error, r);
r = await as('s01', `update public.comments set content='바꿈' where id=${cId}`);
check('댓글 고치기 불가', !!r.error, r);
r = await as('s01', `delete from public.comments where id=${cId}`);
check('s01: 남의 댓글 삭제 0건 (내 글이어도)', !r.error && r.affected === 0, r);
r = await as('s02', `insert into public.comments (post_id, content) values (${cPost}, '')`);
check('빈 댓글 거부', !!r.error, r);
r = await as('s02', `delete from public.comments where id=${cId}`);
check('s02: 내 댓글 삭제', !r.error && r.affected === 1, r);
r = await as('s02', `insert into public.comments (post_id, content) values (${cPost}, '두 번째') returning id`);
r = await as('redsionkim', `delete from public.comments where id=${r.rows[0].id}`);
check('관리자: 학생 댓글 삭제', !r.error && r.affected === 1, r);
await as('s02', `insert into public.comments (post_id, content) values (${cPost}, '남는 댓글')`);
await as('s01', `delete from public.posts where id=${cPost}`);
r = await db.query(`select count(*)::int as n from public.comments where post_id=${cPost}`);
check('글 삭제 시 댓글도 삭제', r.rows[0].n === 0, r.rows);

// ---- 보드 (주제) ----
r = await as('s01', `insert into public.topics (title) values ('학생 주제')`);
check('학생: 주제 만들기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.topics (title, description) values ('내가 좋아하는 책', '한 권 소개하기') returning id`);
check('관리자: 주제 만들기', !r.error, r);
const topicId = r.rows[0].id;
r = await as('s01', `insert into public.posts (title, content, topic_id) values ('어린 왕자', '좋아요', ${topicId}) returning id, topic_id`);
check('학생: 열린 주제에 글쓰기', !r.error && Number(r.rows[0].topic_id) === Number(topicId), r);
const topicPost = r.rows[0].id;
r = await as('s01', `update public.posts set topic_id = null where id=${topicPost}`);
check('학생: 글의 주제 바꾸기 거부', !!r.error, r);
r = await as('s01', `update public.topics set is_open=false where id=${topicId}`);
check('학생: 주제 마감 0건', !r.error && r.affected === 0, r);
r = await as('redsionkim', `update public.topics set is_open=false where id=${topicId}`);
check('관리자: 주제 마감', !r.error && r.affected === 1, r);
r = await as('s02', `insert into public.posts (title, content, topic_id) values ('늦음', 'x', ${topicId})`);
check('학생: 마감된 주제에 글쓰기 거부', !!r.error, r);
r = await as('redsionkim', `delete from public.topics where id=${topicId}`);
check('글이 있는 주제는 지울 수 없음 (기록 보존)', !!r.error, r);
r = await as('s02', `select title from public.posts where topic_id=${topicId}`);
check('마감된 주제의 글도 계속 보임', r.rows?.length === 1, r);

// ---- 퀴즈 ----
r = await as('s01', `insert into public.quizzes (title) values ('몰래')`);
check('학생: 퀴즈 만들기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.quizzes (title) values ('수도 퀴즈') returning id`);
const quizId = r.rows[0].id;
r = await as('redsionkim', `insert into public.quiz_questions (quiz_id, position, question, choices) values
  (${quizId}, 1, '우리나라 수도는?', array['부산','서울','대구']),
  (${quizId}, 2, '일본의 수도는?', null),
  (${quizId}, 3, '1+1은?', array['1','2']) returning id`);
const [q1, q2, q3] = r.rows.map((row) => row.id);
r = await as('redsionkim', `insert into public.quiz_keys (question_id, answer) values (${q1}, '2'), (${q2}, '도쿄|동경'), (${q3}, '2')`);
check('관리자: 문제·정답 만들기', !r.error, r);

r = await as('s01', `select * from public.quiz_keys`);
check('학생: 정답 읽기 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `select question, choices from public.quiz_questions where quiz_id=${quizId}`);
check('학생: 시작 전 문제 읽기 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `select public.submit_quiz(${quizId}, '{}'::jsonb)`);
check('학생: 시작 전 제출 거부', !!r.error && r.error.includes('시작'), r);
r = await as('s01', `insert into public.quiz_starts (quiz_id, user_id, started_at) values (${quizId}, '${ids.s01}', now() - interval '1 hour')`);
check('학생: 시작 시각 직접 기록 거부', !!r.error, r);
r = await as('s01', `select public.start_quiz(${quizId}) as res`);
check('학생: 시작 → 서버 시각', !r.error && !!r.rows[0].res.started_at, r);
const firstStart = r.rows[0].res.started_at;
r = await as('s01', `select public.start_quiz(${quizId}) as res`);
check('다시 시작해도 처음 시각 유지', r.rows[0].res.started_at === firstStart, r);
r = await as('s01', `select question, choices from public.quiz_questions where quiz_id=${quizId}`);
check('학생: 시작 후 문제 읽기', r.rows?.length === 3, r);
r = await as('s02', `select question from public.quiz_questions where quiz_id=${quizId}`);
check('s02: 시작 안 했으면 문제 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `select * from public.quiz_review(${quizId})`);
check('학생: 제출 전 정답 보기 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `insert into public.quiz_attempts (quiz_id, user_id, answers, score, total) values (${quizId}, '${ids.s01}', '{}', 3, 3)`);
check('학생: 점수 직접 기록 거부', !!r.error, r);

r = await as('s01', `select public.submit_quiz(${quizId}, '{"${q1}":"2","${q2}":" 동 경 ","${q3}":"1"}'::jsonb) as res`);
check('학생: 제출·채점 (2/3, 띄어쓰기·여러 정답 허용)', !r.error && r.rows[0].res.score === 2 && r.rows[0].res.total === 3, r);
r = await as('s01', `select elapsed_ms from public.quiz_attempts where quiz_id=${quizId}`);
check('걸린 시간 기록', r.rows?.[0]?.elapsed_ms >= 0, r);
r = await as('s01', `select public.submit_quiz(${quizId}, '{}'::jsonb)`);
check('학생: 두 번 제출 거부', !!r.error && r.error.includes('이미'), r);
r = await as('s01', `select * from public.quiz_review(${quizId})`);
check('학생: 제출 후 정답 보기', r.rows?.length === 3, r);
r = await as('s02', `select score from public.quiz_attempts`);
check('s02: 남의 점수 읽기 0건', !r.error && r.rows.length === 0, r);
r = await as('s02', `select * from public.quiz_participation(${quizId})`);
check('s02: 참가 현황 (누가 냈는지만)', r.rows?.length === 1 && r.rows[0].user_id === ids.s01 && !('score' in r.rows[0]), r);
r = await as('anon', `select * from public.quiz_participation(${quizId})`);
check('비로그인: 참가 현황 거부', !!r.error || r.rows.length === 0, r);
r = await as('redsionkim', `select score from public.quiz_attempts where quiz_id=${quizId}`);
check('관리자: 모든 점수 보기', r.rows?.length === 1 && r.rows[0].score === 2, r);
// 제한 시간과 빨리 푼 순위
r = await as('redsionkim', `update public.quizzes set time_limit_sec = 60 where id=${quizId}`);
r = await as('s02', `select public.start_quiz(${quizId}) as res`);
check('제한 시간 정보 전달', r.rows?.[0]?.res.time_limit_sec === 60, r);
await db.exec(`update public.quiz_starts set started_at = now() - interval '200 seconds' where user_id='${ids.s02}'`);
r = await as('s02', `select public.submit_quiz(${quizId}, '{"${q1}":"2","${q2}":"도쿄","${q3}":"2"}'::jsonb)`);
check('제한 시간 지나면 제출 거부', !!r.error && r.error.includes('제한 시간'), r);
await db.exec(`update public.quiz_starts set started_at = now() - interval '70 seconds' where user_id='${ids.s02}'`);
r = await as('s02', `select public.submit_quiz(${quizId}, '{"${q1}":"2","${q2}":"도쿄","${q3}":"2"}'::jsonb) as res`);
check('30초 여유 안에는 제출됨 (만점)', !r.error && r.rows[0].res.score === 3, r);
r = await as('s01', `select * from public.quiz_speed_ranking(${quizId})`);
check('빨리 푼 순위: 만점자만, 점수 없이', r.rows?.length === 1 && r.rows[0].user_id === ids.s02 && r.rows[0].elapsed_ms === 60000 && !('score' in r.rows[0]), r);
r = await as('anon', `select * from public.quiz_speed_ranking(${quizId})`);
check('비로그인: 빨리 푼 순위 거부', !!r.error || r.rows.length === 0, r);
r = await as('s01', `delete from public.quiz_starts where quiz_id=${quizId}`);
check('학생: 시작 기록 지우기 0건', !r.error && r.affected === 0, r);
await as('redsionkim', `delete from public.quiz_attempts where quiz_id=${quizId} and user_id='${ids.s02}'`);

r = await as('redsionkim', `update public.quizzes set is_open=false where id=${quizId}`);
r = await as('s02', `select public.submit_quiz(${quizId}, '{}'::jsonb)`);
check('닫힌 퀴즈 제출 거부', !!r.error && r.error.includes('닫혔'), r);
r = await as('s02', `select public.start_quiz(${quizId})`);
check('닫힌 퀴즈 시작 거부', !!r.error && r.error.includes('닫혔'), r);
r = await as('s01', `delete from public.quiz_attempts where quiz_id=${quizId}`);
check('학생: 내 답안 지우기 0건 (다시 풀기 불가)', !r.error && r.affected === 0, r);
r = await as('redsionkim', `delete from public.quiz_attempts where quiz_id=${quizId} and user_id='${ids.s01}'`);
check('관리자: 답안 지워서 다시 풀게 하기', !r.error && r.affected === 1, r);
r = await as('redsionkim', `delete from public.quizzes where id=${quizId}`);
r = await db.query(`select count(*)::int as n from public.quiz_keys`);
check('퀴즈 삭제 시 문제·정답도 삭제', r.rows[0].n === 0, r.rows);

// ---- 공감 ----
r = await as('s01', `insert into public.posts (title, content) values ('공감 글', '눌러 줘') returning id`);
const likePost = r.rows[0].id;
r = await as('s02', `insert into public.post_likes (post_id) values (${likePost})`);
check('s02: 공감 누르기', !r.error, r);
r = await as('s02', `insert into public.post_likes (post_id) values (${likePost})`);
check('공감 두 번 거부', !!r.error, r);
r = await as('s02', `insert into public.post_likes (post_id, user_id) values (${likePost}, '${ids.s01}')`);
check('남의 이름으로 공감 거부', !!r.error, r);
r = await as('s01', `select user_id from public.post_likes where post_id=${likePost}`);
check('공감한 사람 보기', r.rows?.length === 1, r);
r = await as('s01', `delete from public.post_likes where post_id=${likePost}`);
check('남의 공감 취소 0건', !r.error && r.affected === 0, r);
r = await as('s02', `delete from public.post_likes where post_id=${likePost}`);
check('내 공감 취소', !r.error && r.affected === 1, r);

// ---- 1인1역 ----
r = await as('s01', `insert into public.jobs (name) values ('반장')`);
check('학생: 역할 만들기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.jobs (name, description) values ('칠판 지우기', '쉬는 시간마다') returning id`);
const jobId = r.rows[0].id;
r = await as('redsionkim', `insert into public.job_assignments (user_id, job_id) values ('${ids.s01}', ${jobId}), ('${ids.s02}', ${jobId})`);
check('관리자: 역할 배정', !r.error, r);
r = await as('s01', `update public.job_assignments set job_id=${jobId} where user_id='${ids.s02}'`);
check('학생: 배정 바꾸기 0건', !r.error && r.affected === 0, r);
r = await as('s01', `insert into public.job_checks (user_id) values ('${ids.s01}')`);
check('학생: 오늘 했어요 체크', !r.error, r);
r = await as('s01', `insert into public.job_checks (user_id, check_date) values ('${ids.s01}', '2020-01-01')`);
check('학생: 지난 날짜 체크 거부', !!r.error, r);
r = await as('s01', `insert into public.job_checks (user_id) values ('${ids.s02}')`);
check('학생: 친구 대신 체크 거부', !!r.error, r);
r = await as('s02', `select user_id from public.job_checks`);
check('현황 보기 (누가 했는지)', r.rows?.length === 1, r);
r = await as('redsionkim', `insert into public.job_checks (user_id, check_date) values ('${ids.s02}', '2020-01-01')`);
check('관리자: 다른 학생·날짜 체크', !r.error, r);
r = await as('s02', `delete from public.job_checks where check_date='2020-01-01'`);
check('학생: 지난 기록 지우기 0건', !r.error && r.affected === 0, r);
r = await as('s01', `delete from public.job_checks where user_id='${ids.s01}'`);
check('학생: 오늘 체크 취소', !r.error && r.affected === 1, r);
r = await as('redsionkim', `delete from public.jobs where id=${jobId}`);
r = await db.query(`select count(*)::int as n from public.job_assignments`);
check('역할 삭제 시 배정도 삭제', r.rows[0].n === 0, r.rows);

// ---- 일정 ----
r = await as('s01', `insert into public.events (event_date, title) values ('2026-10-09', '한글날')`);
check('학생: 일정 쓰기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.events (event_date, title) values ('2026-10-09', '한글날')`);
check('관리자: 일정 쓰기', !r.error, r);
r = await as('s01', `select title from public.events`);
check('학생: 일정 보기', r.rows?.length === 1, r);

// ---- 점수 (관리자만) ----
r = await as('s01', `insert into public.points (user_id, points) values ('${ids.s01}', 100)`);
check('학생: 점수 주기 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.points (user_id, points, reason) values ('${ids.s01}', 5, '발표'), ('${ids.s02}', 3, '청소')`);
check('관리자: 점수 주기', !r.error, r);
r = await as('redsionkim', `insert into public.points (user_id, points) values ('${ids.s01}', 0)`);
check('0점은 거부', !!r.error, r);
r = await as('s01', `select points from public.points`);
check('학생: 점수 읽기 0건 (자기 것도)', !r.error && r.rows.length === 0, r);
r = await as('anon', `select * from public.points`);
check('비로그인: 점수 거부', !!r.error, r);
r = await as('redsionkim', `select sum(points)::int as s from public.points`);
check('관리자: 점수 합계', r.rows?.[0]?.s === 8, r);

// ---- 순위 (학생은 등수만) ----
r = await as('s02', `select * from public.points_ranking() order by rank`);
check('학생: 순위 보기 (등수만)', r.rows?.length >= 2 && r.rows[0].user_id === ids.s01 && Number(r.rows[0].rank) === 1 && !('points' in r.rows[0]), r);
check('순위: 관리자 계정은 빠짐', !r.rows.some((row) => row.user_id === ids.redsionkim), r);
r = await as('anon', `select * from public.points_ranking()`);
check('비로그인: 순위 거부', !!r.error || r.rows.length === 0, r);

// ---- 자리 뽑기 (관리자만) ----
r = await as('s01', `insert into public.seat_rules (member_ids) values (array['${ids.s01}', '${ids.s02}']::uuid[])`);
check('학생: 자리 설정 거부', !!r.error, r);
r = await as('redsionkim', `insert into public.seat_rules (member_ids, note) values (array['${ids.s01}', '${ids.s02}']::uuid[], '떨어뜨리기')`);
check('관리자: 같은 모둠 금지 설정', !r.error, r);
r = await as('redsionkim', `insert into public.seat_rules (member_ids) values (array['${ids.s01}']::uuid[])`);
check('금지 묶음은 2명 이상', !!r.error, r);
r = await as('s01', `select * from public.seat_rules`);
check('학생: 자리 설정 읽기 0건', !r.error && r.rows.length === 0, r);
r = await as('redsionkim', `insert into public.seat_draws (group_size, groups) values (4, '[["${ids.s01}"],["${ids.s02}"]]')`);
check('관리자: 자리 저장', !r.error, r);
r = await as('s02', `select * from public.seat_draws`);
check('학생: 자리 기록 읽기 0건', !r.error && r.rows.length === 0, r);

// ---- 실시간 퀴즈 ----
r = await as('redsionkim', `insert into public.quizzes (title, mode, time_limit_sec) values ('실시간 수도', 'live', 60) returning id`);
const liveId = r.rows[0].id;
r = await as('redsionkim', `insert into public.quiz_questions (quiz_id, position, question, choices) values (${liveId}, 1, '한국 수도?', array['부산','서울']), (${liveId}, 2, '일본 수도?', null) returning id`);
const [lq1, lq2] = r.rows.map((row) => row.id);
await as('redsionkim', `insert into public.quiz_keys (question_id, answer) values (${lq1}, '2'), (${lq2}, '도쿄')`);

r = await as('s01', `select question from public.quiz_questions where quiz_id=${liveId}`);
check('실시간: 시작 전 문제 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `select public.answer_live(${lq1}, '2')`);
check('실시간: 시작 전 답하기 거부', !!r.error, r);
r = await as('s01', `select public.live_control(${liveId}, 'start')`);
check('학생: 실시간 시작 거부', !!r.error, r);
r = await as('s01', `select public.start_quiz(${liveId})`);
check('실시간 퀴즈는 혼자 풀기 시작 거부', !!r.error, r);
r = await as('s01', `select public.live_state(${liveId}) as st`);
check('상태: 대기', r.rows?.[0]?.st?.status === 'waiting' && r.rows[0].st.total === 2, r);

r = await as('redsionkim', `select public.live_control(${liveId}, 'start')`);
check('관리자: 실시간 시작', !r.error, r);
r = await as('s01', `select public.live_state(${liveId}) as st`);
check('상태: 진행 중 + 서버 시각', r.rows?.[0]?.st?.status === 'running' && !!r.rows[0].st.started_at, r);
r = await as('s01', `select question from public.quiz_questions where quiz_id=${liveId}`);
check('실시간: 시작 후 문제 보임', r.rows?.length === 2, r);
r = await as('s01', `select * from public.quiz_keys where question_id=${lq1}`);
check('실시간: 정답은 여전히 0건', !r.error && r.rows.length === 0, r);
r = await as('s01', `select public.answer_live(${lq1}, '2') as res`);
check('실시간: 답하기 → 맞음, 1/2', r.rows?.[0]?.res?.correct === true && r.rows[0].res.answered === 1 && r.rows[0].res.total === 2, r);
r = await as('s01', `select public.answer_live(${lq1}, '1')`);
check('실시간: 같은 문제 두 번 거부', !!r.error && r.error.includes('이미'), r);
r = await as('s01', `select public.answer_live(${lq2}, '오사카') as res`);
check('실시간: 틀림, 2/2', r.rows?.[0]?.res?.correct === false && r.rows[0].res.answered === 2, r);
r = await as('s01', `insert into public.live_answers (quiz_id, question_id, user_id, answer, correct) values (${liveId}, ${lq2}, '${ids.s02}', 'x', true)`);
check('실시간: 답 직접 기록 거부', !!r.error, r);
r = await as('s02', `select * from public.live_answers`);
check('s02: 남의 답 0건', !r.error && r.rows.length === 0, r);
r = await as('redsionkim', `select user_id, correct from public.live_answers where quiz_id=${liveId}`);
check('관리자: 모든 답 보기 (레이스용)', r.rows?.length === 2, r);
await db.exec(`update public.quizzes set live_started_at = now() - interval '100 seconds' where id=${liveId}`);
r = await as('s02', `select public.answer_live(${lq1}, '2')`);
check('실시간: 시간 끝나면 답하기 거부', !!r.error && r.error.includes('시간'), r);
r = await as('s02', `select public.live_state(${liveId}) as st`);
check('상태: 시간 지나면 끝', r.rows?.[0]?.st?.status === 'ended', r);
r = await as('redsionkim', `select public.live_control(${liveId}, 'reset')`);
r = await db.query(`select count(*)::int as n from public.live_answers where quiz_id=${liveId}`);
check('관리자: 다시 하기 → 답 모두 지움, 대기', r.rows[0].n === 0, r.rows);
r = await as('s01', `select question from public.quiz_questions where quiz_id=${liveId}`);
check('다시 하기 후 문제 다시 숨김', !r.error && r.rows.length === 0, r);

// ---- 실명 (관리자만) ----
r = await as('redsionkim', `insert into public.student_names (user_id, real_name) values ('${ids.s02}', '김민준')`);
check('관리자: 실명 입력', !r.error, r);
r = await as('redsionkim', `select real_name from public.student_names`);
check('관리자: 실명 보기', r.rows?.[0]?.real_name === '김민준', r);
r = await as('s02', `select real_name from public.student_names`);
check('학생: 실명 읽기 0건 (자기 것도)', !r.error && r.rows.length === 0, r);
r = await as('s01', `insert into public.student_names (user_id, real_name) values ('${ids.s01}', '가짜')`);
check('학생: 실명 쓰기 거부', !!r.error, r);
r = await as('s02', `update public.student_names set real_name='바꿈'`);
check('학생: 실명 고치기 0건', !r.error && r.affected === 0, r);
r = await as('anon', `select * from public.student_names`);
check('비로그인: 실명 거부', !!r.error, r);

// ---- 첨부 파일 ----
r = await db.query(`select public, file_size_limit from storage.buckets where id='attachments'`);
check('보관함: 비공개, 50MB 제한', r.rows[0]?.public === false && Number(r.rows[0]?.file_size_limit) === 52428800, r.rows);

r = await as('s01', `insert into public.posts (title, content) values ('사진 글', '첨부') returning id`);
const filePost = r.rows[0].id;
const s01Path = `${ids.s01}/${filePost}/a.jpg`;
r = await as('s01', `insert into storage.objects (bucket_id, name) values ('attachments', '${s01Path}')`);
check('s01: 내 글 폴더에 파일 올리기', !r.error, r);
r = await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${s01Path}', '우리반.jpg', 1000, 'image/jpeg')`);
check('s01: 첨부 목록 등록', !r.error, r);

r = await as('s02', `select name from storage.objects where name='${s01Path}'`);
check('s02: 남의 글 파일 내려받기 가능', r.rows?.length === 1, r);
r = await as('s02', `select name from public.post_files where post_id=${filePost}`);
check('s02: 첨부 목록 보기 가능', r.rows?.length === 1, r);
r = await as('anon', `select name from storage.objects`);
check('비로그인: 파일 내려받기 거부', !!r.error || r.rows.length === 0, r);
r = await as('anon', `select * from public.post_files`);
check('비로그인: 첨부 목록 거부', !!r.error, r);

r = await as('s02', `insert into storage.objects (bucket_id, name) values ('attachments', '${s01Path.replace('a.jpg', 'b.jpg')}')`);
check('s02: 남의 폴더에 올리기 거부', !!r.error, r);
r = await as('s02', `insert into storage.objects (bucket_id, name) values ('attachments', '${ids.s02}/${filePost}/c.jpg')`);
check('s02: 내 폴더라도 남의 글 번호면 거부', !!r.error, r);
r = await as('s02', `insert into storage.objects (bucket_id, name) values ('attachments', '${ids.s02}/abc/c.jpg')`);
check('s02: 이상한 폴더 이름 거부', !!r.error, r);
r = await as('s02', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s02}/${filePost}/x.jpg', 'x.jpg', 1, 'image/jpeg')`);
check('s02: 남의 글에 첨부 등록 거부', !!r.error, r);
r = await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s02}/${filePost}/y.jpg', 'y.jpg', 1, 'image/jpeg')`);
check('s01: 남의 폴더 경로로 등록 거부', !!r.error, r);

r = await as('s02', `delete from storage.objects where name='${s01Path}'`);
check('s02: 남의 파일 삭제 0건', !r.error && r.affected === 0, r);
r = await as('s02', `delete from public.post_files where post_id=${filePost}`);
check('s02: 남의 첨부 목록 삭제 0건', !r.error && r.affected === 0, r);

r = await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s01}/${filePost}/big.pdf', 'big.pdf', 30000000, 'application/pdf')`);
check('첨부: 30MB 파일 기록 가능', !r.error, r);
r = await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s01}/${filePost}/huge.pdf', 'huge.pdf', 60000000, 'application/pdf')`);
check('첨부: 50MB 넘는 파일 거부', !!r.error, r);
await as('s01', `delete from public.post_files where name='big.pdf'`);

for (let i = 2; i <= 5; i++) {
  await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s01}/${filePost}/${i}.jpg', '${i}.jpg', 1, 'image/jpeg')`);
}
r = await as('s01', `insert into public.post_files (post_id, path, name, size, mime) values (${filePost}, '${ids.s01}/${filePost}/6.jpg', '6.jpg', 1, 'image/jpeg')`);
check('글 하나에 파일 5개까지', !!r.error && r.error.includes('5개'), r);

r = await as('redsionkim', `delete from storage.objects where name='${s01Path}'`);
check('관리자: 학생 파일 삭제', !r.error && r.affected === 1, r);
r = await as('redsionkim', `delete from public.posts where id=${filePost}`);
r = await db.query(`select count(*)::int as n from public.post_files where post_id=${filePost}`);
check('글 삭제 시 첨부 목록도 삭제', r.rows[0].n === 0, r.rows);

await db.exec(`insert into public.posts (author_id, title, content) values ('${ids.s01}', '남는 글', 'x')`);
await db.exec(`delete from auth.users where email='s01@class52.local'`);
r = await db.query(`select count(*)::int as n from public.posts`);
check('계정 삭제 시 글도 삭제', r.rows[0].n === 0, r.rows);

console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
