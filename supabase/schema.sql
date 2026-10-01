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


-- ---------------------------------------------------------------------
-- 6-2. meals : 급식 식단 (관리자가 날짜별로 직접 입력, 하루에 하나)
-- ---------------------------------------------------------------------
create table if not exists public.meals (
  id         bigint generated always as identity primary key,
  meal_date  date not null unique,                                    -- 급식 날짜 (하루 한 번)
  menu       text not null check (char_length(menu) between 1 and 1000), -- 메뉴 (한 줄에 한 가지)
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6-3. post_files : 게시글 첨부 파일 목록
--      실제 파일은 Supabase Storage의 비공개 보관함 "attachments"에 있고,
--      여기에는 원래 파일 이름·크기·종류와 보관 위치(path)만 적습니다.
--      보관 위치 모양: 올린사람ID/글번호/무작위이름.확장자
-- ---------------------------------------------------------------------
create table if not exists public.post_files (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.posts (id) on delete cascade,     -- 어느 글의 파일인지 (글이 지워지면 함께 지워짐)
  uploader_id uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- 올린 사람
  path        text not null unique,                                              -- 보관 위치
  name        text not null check (char_length(name) between 1 and 200),         -- 원래 파일 이름 (내려받을 때 쓰는 이름)
  size        integer not null,                                                  -- 크기 (최대 50MB, 아래 규칙)
  mime        text not null,                                                     -- 파일 종류
  created_at  timestamptz not null default now()
);

create index if not exists post_files_post_id_idx on public.post_files (post_id);

-- 파일 크기 규칙: 1바이트 ~ 50MB (예전 10MB 규칙이 있으면 바꿈)
alter table public.post_files drop constraint if exists post_files_size_check;
alter table public.post_files add constraint post_files_size_check check (size between 1 and 52428800);

-- ---------------------------------------------------------------------
-- 6-5. comments : 게시글 댓글 (글자만)
-- ---------------------------------------------------------------------
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts (id) on delete cascade,             -- 어느 글의 댓글인지 (글이 지워지면 함께 지워짐)
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade, -- 댓글 쓴 사람 = 로그인한 사람
  content    text not null check (char_length(content) between 1 and 500),            -- 내용 (500자 이내)
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments (post_id, created_at);


-- ---------------------------------------------------------------------
-- 6-4. student_names : 학생 실명 (관리용)
--      관리자(선생님)만 읽고 쓸 수 있습니다. 학생은 친구 실명을 볼 수 없습니다.
--      (profiles와 따로 둔 이유: profiles는 반 전체가 읽을 수 있기 때문)
-- ---------------------------------------------------------------------
create table if not exists public.student_names (
  user_id    uuid primary key references public.profiles (id) on delete cascade, -- 계정이 지워지면 함께 지워짐
  real_name  text not null check (char_length(real_name) between 1 and 20),       -- 실명
  updated_at timestamptz not null default now()
);


-- 글 하나에 파일은 최대 5개
create or replace function public.limit_post_files()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.post_files where post_id = new.post_id) >= 5 then
    raise exception '글 하나에 파일은 5개까지 올릴 수 있어요.';
  end if;
  return new;
end;
$$;

drop trigger if exists post_files_limit on public.post_files;
create trigger post_files_limit
  before insert on public.post_files
  for each row execute function public.limit_post_files();


-- =====================================================================
-- 7. 권한 : "어떤 종류의 작업을 할 수 있나" (1차 잠금)
--    anon = 로그인 안 한 사람 → 아무것도 못 함
--    authenticated = 로그인한 우리 반 → 아래에 적은 것만 가능
-- =====================================================================
revoke all on public.profiles, public.posts, public.lessons, public.homework, public.meals from anon, authenticated;

-- profiles : 읽기, 그리고 "별명" 칸만 고치기 (역할(role)은 학생이 절대 못 바꿈)
grant select on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;

-- posts : 제목·내용만 쓰고 고칠 수 있음 (글쓴이·작성 시각은 바꿀 수 없음)
grant select, delete on public.posts to authenticated;
grant insert (title, content), update (title, content) on public.posts to authenticated;

-- lessons, homework, meals : 권한은 열어 두되, 실제로는 아래 RLS가 관리자만 통과시킴
grant select, insert, update, delete on public.lessons, public.homework, public.meals to authenticated;

-- post_files : 읽기, 올리기(이름·위치·크기·종류만), 지우기. 고치기는 없음
revoke all on public.post_files from anon, authenticated;
grant select, delete on public.post_files to authenticated;
grant insert (post_id, path, name, size, mime) on public.post_files to authenticated;

-- comments : 읽기, 쓰기(어느 글에·내용만), 지우기. 고치기는 없음
revoke all on public.comments from anon, authenticated;
grant select, delete on public.comments to authenticated;
grant insert (post_id, content) on public.comments to authenticated;

-- student_names : 권한은 열어 두되, 실제로는 아래 RLS가 관리자만 통과시킴
revoke all on public.student_names from anon, authenticated;
grant select, insert, update, delete on public.student_names to authenticated;


-- =====================================================================
-- 8. RLS 보안 규칙 : "어떤 줄을 읽고 쓸 수 있나" (2차 잠금)
--    RLS를 켜면, 규칙에 맞지 않는 작업은 모두 거절됩니다.
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.lessons  enable row level security;
alter table public.homework enable row level security;
alter table public.meals    enable row level security;
alter table public.post_files enable row level security;
alter table public.student_names enable row level security;
alter table public.comments enable row level security;

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

-- ---- meals ----
drop policy if exists "meals: 로그인하면 읽기" on public.meals;
create policy "meals: 로그인하면 읽기" on public.meals
  for select to authenticated
  using (true);

drop policy if exists "meals: 관리자만 쓰고 고치고 지우기" on public.meals;
create policy "meals: 관리자만 쓰고 고치고 지우기" on public.meals
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---- post_files ----
drop policy if exists "post_files: 로그인하면 읽기" on public.post_files;
create policy "post_files: 로그인하면 읽기" on public.post_files
  for select to authenticated
  using (true);

-- 내 글에, 내 이름으로, 내 폴더(내ID/글번호/...)에 있는 파일만 등록
drop policy if exists "post_files: 내 글에만 올리기" on public.post_files;
create policy "post_files: 내 글에만 올리기" on public.post_files
  for insert to authenticated
  with check (
    uploader_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
    and path like (select auth.uid())::text || '/' || post_id::text || '/%'
  );

drop policy if exists "post_files: 올린 사람 또는 관리자만 지우기" on public.post_files;
create policy "post_files: 올린 사람 또는 관리자만 지우기" on public.post_files
  for delete to authenticated
  using (uploader_id = (select auth.uid()) or (select public.is_admin()));


-- ---- comments ----
drop policy if exists "comments: 로그인하면 읽기" on public.comments;
create policy "comments: 로그인하면 읽기" on public.comments
  for select to authenticated
  using (true);

drop policy if exists "comments: 내 이름으로만 쓰기" on public.comments;
create policy "comments: 내 이름으로만 쓰기" on public.comments
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "comments: 내 댓글 또는 관리자만 지우기" on public.comments;
create policy "comments: 내 댓글 또는 관리자만 지우기" on public.comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ---- student_names : 관리자만 (학생은 읽기도 안 됨) ----
drop policy if exists "student_names: 관리자만" on public.student_names;
create policy "student_names: 관리자만" on public.student_names
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- =====================================================================
-- 9. 파일 보관함 (Supabase Storage) : "attachments"
--    · 비공개(public = false) → 로그인한 우리 반만 내려받을 수 있음
--    · 파일 하나 최대 50MB (Supabase 무료 플랜의 최대치), 사진·문서 종류만 허용 (실행 파일 등은 거절)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 52428800,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain',
    'application/x-hwp', 'application/vnd.hancom.hwpx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 로그인한 사람은 누구나 첨부 파일을 내려받을 수 있음 (다른 친구 글의 파일도)
drop policy if exists "attachments: 로그인하면 내려받기" on storage.objects;
create policy "attachments: 로그인하면 내려받기" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

-- 내 폴더(내ID/내글번호/...)에만 올리기
drop policy if exists "attachments: 내 글 폴더에만 올리기" on storage.objects;
create policy "attachments: 내 글 폴더에만 올리기" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and case
          when (storage.foldername(name))[2] ~ '^[0-9]+$' then exists (
            select 1 from public.posts p
            where p.id = ((storage.foldername(name))[2])::bigint
              and p.author_id = (select auth.uid())
          )
          else false
        end
  );

-- 내가 올린 파일, 또는 관리자만 지우기
drop policy if exists "attachments: 올린 사람 또는 관리자만 지우기" on storage.objects;
create policy "attachments: 올린 사람 또는 관리자만 지우기" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );


-- =====================================================================
-- 끝! 이제 Authentication → Users 에서 계정을 만든 뒤,
-- supabase/make-admin.sql 을 실행해 redsionkim 을 관리자로 지정하세요.
-- =====================================================================
