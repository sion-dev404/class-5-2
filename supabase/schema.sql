-- =====================================================================
-- 5학년 2반 학급 누리집 : 데이터베이스와 보안 규칙(RLS)
--
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--   · 여러 번 실행해도 괜찮습니다. (이미 있는 것은 건너뛰거나 새로 덮어씁니다)
--   · 비밀번호나 키는 이 파일에 들어 있지 않습니다.
--   · 계정(Authentication → Users)은 이 파일을 실행한 "다음에" 만드세요.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. profiles : 계정마다 한 줄. 아이디, 별명, 역할(관리자/학생)만 저장
--    실명·사진·연락처 칸은 일부러 만들지 않습니다.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade, -- 계정이 지워지면 함께 지워짐
  username   text not null unique,                                        -- 로그인 아이디 (예: s01)
  nickname   text check (nickname is null or char_length(nickname) between 1 and 10), -- 별명 (선택, 10자 이내)
  role       text not null default 'student' check (role in ('admin', 'student')),     -- 역할
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. 새 계정이 생기면 profiles에 자동으로 한 줄 만들기 (처음엔 모두 학생)
--    아이디는 로그인 이메일의 @ 앞부분입니다. (s01@class52.local → s01)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 혹시 이 파일보다 계정을 먼저 만들었다면, 그 계정들의 profiles 줄도 채워 넣기
insert into public.profiles (id, username)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3. is_admin() : "지금 로그인한 사람이 관리자인가?"를 알려 주는 함수
--    아래 보안 규칙들이 모두 이 함수로 관리자를 판단합니다.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 4. posts : 게시판 글 (글자만, 사진 없음)
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id         bigint generated always as identity primary key,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- 글쓴이 = 로그인한 사람
  title      text not null check (char_length(title) between 1 and 50),
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_id_idx on public.posts (author_id);

-- 글을 고치면 "고친 시각"을 자동으로 기록
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 5. lessons : 오늘의 수업 (날짜별)
-- ---------------------------------------------------------------------
create table if not exists public.lessons (
  id          bigint generated always as identity primary key,
  lesson_date date not null,                                            -- 수업 날짜
  period      smallint check (period is null or period between 1 and 8), -- 교시 (선택)
  subject     text not null check (char_length(subject) between 1 and 20), -- 과목
  content     text not null check (char_length(content) between 1 and 2000), -- 수업 내용
  created_at  timestamptz not null default now()
);

create index if not exists lessons_date_idx on public.lessons (lesson_date);


-- ---------------------------------------------------------------------
-- 6. homework : 숙제 (마감일)
-- ---------------------------------------------------------------------
create table if not exists public.homework (
  id         bigint generated always as identity primary key,
  title      text not null check (char_length(title) between 1 and 50),
  content    text check (content is null or char_length(content) <= 1000), -- 자세한 설명 (선택)
  due_date   date not null,                                                -- 마감일
  created_at timestamptz not null default now()
);

create index if not exists homework_due_date_idx on public.homework (due_date);


-- =====================================================================
-- 7. 권한 : "어떤 종류의 작업을 할 수 있나" (1차 잠금)
--    anon = 로그인 안 한 사람 → 아무것도 못 함
--    authenticated = 로그인한 우리 반 → 아래에 적은 것만 가능
-- =====================================================================
revoke all on public.profiles, public.posts, public.lessons, public.homework from anon, authenticated;

-- profiles : 읽기, 그리고 "별명" 칸만 고치기 (역할(role)은 학생이 절대 못 바꿈)
grant select on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;

-- posts : 제목·내용만 쓰고 고칠 수 있음 (글쓴이·작성 시각은 바꿀 수 없음)
grant select, delete on public.posts to authenticated;
grant insert (title, content), update (title, content) on public.posts to authenticated;

-- lessons, homework : 권한은 열어 두되, 실제로는 아래 RLS가 관리자만 통과시킴
grant select, insert, update, delete on public.lessons, public.homework to authenticated;


-- =====================================================================
-- 8. RLS 보안 규칙 : "어떤 줄을 읽고 쓸 수 있나" (2차 잠금)
--    RLS를 켜면, 규칙에 맞지 않는 작업은 모두 거절됩니다.
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.lessons  enable row level security;
alter table public.homework enable row level security;

-- ---- profiles ----
drop policy if exists "profiles: 로그인하면 읽기" on public.profiles;
create policy "profiles: 로그인하면 읽기" on public.profiles
  for select to authenticated
  using (true);

drop policy if exists "profiles: 내 줄만 고치기" on public.profiles;
create policy "profiles: 내 줄만 고치기" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---- posts ----
drop policy if exists "posts: 로그인하면 읽기" on public.posts;
create policy "posts: 로그인하면 읽기" on public.posts
  for select to authenticated
  using (true);

drop policy if exists "posts: 내 이름으로만 쓰기" on public.posts;
create policy "posts: 내 이름으로만 쓰기" on public.posts
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "posts: 내 글만 고치기" on public.posts;
create policy "posts: 내 글만 고치기" on public.posts
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "posts: 내 글 또는 관리자만 지우기" on public.posts;
create policy "posts: 내 글 또는 관리자만 지우기" on public.posts
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ---- lessons ----
drop policy if exists "lessons: 로그인하면 읽기" on public.lessons;
create policy "lessons: 로그인하면 읽기" on public.lessons
  for select to authenticated
  using (true);

drop policy if exists "lessons: 관리자만 쓰고 고치고 지우기" on public.lessons;
create policy "lessons: 관리자만 쓰고 고치고 지우기" on public.lessons
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---- homework ----
drop policy if exists "homework: 로그인하면 읽기" on public.homework;
create policy "homework: 로그인하면 읽기" on public.homework
  for select to authenticated
  using (true);

drop policy if exists "homework: 관리자만 쓰고 고치고 지우기" on public.homework;
create policy "homework: 관리자만 쓰고 고치고 지우기" on public.homework
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- =====================================================================
-- 끝! 이제 Authentication → Users 에서 계정을 만든 뒤,
-- supabase/make-admin.sql 을 실행해 redsionkim 을 관리자로 지정하세요.
-- =====================================================================
