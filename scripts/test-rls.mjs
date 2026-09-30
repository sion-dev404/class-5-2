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

// ---- 첨부 파일 ----
r = await db.query(`select public, file_size_limit from storage.buckets where id='attachments'`);
check('보관함: 비공개, 10MB 제한', r.rows[0]?.public === false && Number(r.rows[0]?.file_size_limit) === 10485760, r.rows);

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
