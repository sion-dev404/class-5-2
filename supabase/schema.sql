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

-- 회원가입 승인 상태: pending = 승인 대기(아무것도 못 봄), approved = 승인됨
--   (이 칸을 처음 만들 때 이미 있던 계정은 approved, 그 뒤 새로 가입하는 계정은 pending)
alter table public.profiles add column if not exists status text not null default 'approved' check (status in ('pending', 'approved'));
alter table public.profiles alter column status set default 'pending';
-- 개인정보 동의 기록 (언제, 어느 판(버전)에 동의했는지)
alter table public.profiles add column if not exists privacy_agreed_at timestamptz;
alter table public.profiles add column if not exists privacy_version text;


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
declare
  v_email text := lower(coalesce(new.email, ''));
  v_domain text := split_part(lower(coalesce(new.email, '')), '@', 2);
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_username text := lower(split_part(coalesce(new.email, ''), '@', 1));
  v_real_name text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'real_name', '')), '');
  v_agreed_at timestamptz;
  v_version text;
  v_google boolean := false;
begin
  if v_provider = 'google' then
    -- Google 계정은 어느 것이든 받음 (이메일이 없는 계정만 막음). 쓰려면 동의 + 선생님 승인이 필요
    if v_email = '' or v_domain = '' then
      raise exception '이메일이 있는 Google 계정으로 가입해 주세요.';
    end if;
    v_google := true;
    -- 임시 아이디. 처음 들어와서 동의할 때 자기 아이디로 바꿈 (complete_signup)
    v_username := 'g_' || left(replace(new.id::text, '-', ''), 12);
    v_real_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  else
    -- 아이디·비밀번호 가입은 우리 반 형식(아이디@class52.local)만
    if v_email not like '%@class52.local' or v_username !~ '^[a-z0-9_]{2,30}$' then
      raise exception '아이디는 영어 소문자·숫자·_ 2~30자로 해 주세요.';
    end if;
    begin
      v_agreed_at := (new.raw_user_meta_data ->> 'privacy_agreed_at')::timestamptz;
    exception when others then
      v_agreed_at := null;
    end;
    v_version := left(new.raw_user_meta_data ->> 'privacy_version', 30);
  end if;

  -- Google 가입은 아직 동의 전(privacy_agreed_at 비어 있음) → 화면에서 동의를 받음
  insert into public.profiles (id, username, privacy_agreed_at, privacy_version)
  values (new.id, v_username, v_agreed_at, v_version)
  on conflict (id) do nothing;

  -- 이름(과 Google 이메일)은 선생님만 보는 실명 표에 (승인할 때 누구인지 확인용)
  if v_real_name is not null or v_google then
    insert into public.student_names (user_id, real_name, email)
    values (new.id, left(coalesce(v_real_name, v_username), 20), case when v_google then left(v_email, 200) end)
    on conflict (user_id) do nothing;
  end if;
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
-- 3-2. 사이트 열기/닫기 (계정 도용 같은 사고가 나면 학생에게는 사이트를 닫음)
--      site_settings 는 한 줄뿐. closed = true 이면 학생은 DB의 어떤 자료도 읽고 쓸 수 없음
--      (아래 9-2의 "닫힘 잠금" 규칙). 선생님(관리자)은 그대로 쓸 수 있음.
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
  id         smallint primary key default 1 check (id = 1),                              -- 한 줄만
  closed     boolean not null default true,                                             -- 닫힘 여부 (처음 만들 때 닫힌 상태)
  notice     text not null default '도용 사건으로 사이트가 종료되었습니다.' check (char_length(notice) between 1 and 300),
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.site_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not closed from public.site_settings where id = 1), true);
$$;

revoke execute on function public.site_open() from public;
grant execute on function public.site_open() to anon, authenticated;

-- 승인된 계정인가? (회원가입 후 선생님이 승인해야 true)
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved'
  );
$$;

-- 지금 이 사람이 누리집 자료를 쓸 수 있나? = 선생님이거나, (사이트가 열려 있고 + 승인된 학생)
create or replace function public.can_use()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.site_open() and public.is_approved());
$$;

revoke execute on function public.is_approved(), public.can_use() from public, anon;
grant execute on function public.is_approved(), public.can_use() to authenticated;

-- 학생 로그인 모두 끊기 (선생님만). 끊긴 학생은 다시 로그인해야 함
create or replace function public.sign_out_students()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception '선생님만 할 수 있어요.';
  end if;
  delete from auth.sessions where user_id in (select id from public.profiles where role = 'student');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sign_out_students() from public, anon;
grant execute on function public.sign_out_students() to authenticated;


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
-- 6-6. topics : 보드의 주제 (선생님이 만듦, 지우지 않고 "마감"만 → 지난 기록이 남음)
--      보드 글은 게시판 글(posts)과 같은 표를 쓰고, topic_id 로 주제를 구분합니다.
--      (topic_id 가 비어 있으면 일반 게시판 글)
-- ---------------------------------------------------------------------
create table if not exists public.topics (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 50),               -- 주제
  description text check (description is null or char_length(description) <= 1000),   -- 설명 (선택)
  is_open     boolean not null default true,                                           -- 글쓰기 가능 여부 (마감하면 false)
  created_at  timestamptz not null default now()
);

alter table public.posts add column if not exists topic_id bigint references public.topics (id) on delete restrict;
create index if not exists posts_topic_id_idx on public.posts (topic_id, created_at desc);


-- ---------------------------------------------------------------------
-- 6-7. 퀴즈
--      quizzes        : 퀴즈 (제목·설명·열림/닫힘)
--      quiz_questions : 문제와 보기 (학생도 읽음)
--      quiz_keys      : 정답 (선생님만! 학생은 읽을 수 없음)
--      quiz_attempts  : 학생 답안과 점수 (본인과 선생님만 읽음, 채점 함수만 기록)
-- ---------------------------------------------------------------------
create table if not exists public.quizzes (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 50),
  description text check (description is null or char_length(description) <= 500),
  is_open     boolean not null default true,                                    -- 닫으면 더 이상 참여 못 함
  created_at  timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id       bigint generated always as identity primary key,
  quiz_id  bigint not null references public.quizzes (id) on delete cascade,
  position smallint not null default 1,                                          -- 문제 순서
  question text not null check (char_length(question) between 1 and 500),       -- 문제
  choices  text[] check (choices is null or array_length(choices, 1) between 2 and 5) -- 객관식 보기 (주관식이면 비움)
);

create index if not exists quiz_questions_quiz_id_idx on public.quiz_questions (quiz_id, position);

create table if not exists public.quiz_keys (
  question_id bigint primary key references public.quiz_questions (id) on delete cascade,
  answer      text not null check (char_length(answer) between 1 and 200)  -- 객관식: 보기 번호(1~5) / 주관식: 정답 ( | 로 여러 개 가능)
);

-- 제한 시간 (초, 비우면 무제한)
alter table public.quizzes add column if not exists time_limit_sec integer check (time_limit_sec is null or time_limit_sec between 10 and 3600);

-- 퀴즈 종류: self = 혼자 풀기(시간 날 때), live = 실시간(선생님이 시작하면 모두 함께)
alter table public.quizzes add column if not exists mode text not null default 'self' check (mode in ('self', 'live'));
-- 실시간 퀴즈 상태: waiting = 대기, running = 진행 중, ended = 끝 / 시작 시각(서버 시각)
alter table public.quizzes add column if not exists live_status text not null default 'waiting' check (live_status in ('waiting', 'running', 'ended'));
alter table public.quizzes add column if not exists live_started_at timestamptz;

-- 퀴즈 시작 시각 (서버 시각으로 기록 → 걸린 시간을 공정하게 잼). 시작해야 문제가 보임
create table if not exists public.quiz_starts (
  quiz_id    bigint not null references public.quizzes (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);

create table if not exists public.quiz_attempts (
  id         bigint generated always as identity primary key,
  quiz_id    bigint not null references public.quizzes (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  answers    jsonb not null,                                   -- { "문제번호": "답" }
  score      smallint not null,                                -- 맞힌 개수
  total      smallint not null,                                -- 문제 수
  created_at timestamptz not null default now(),
  unique (quiz_id, user_id)                                    -- 한 사람은 한 번만
);

-- 걸린 시간 (밀리초, 시작 → 제출)
alter table public.quiz_attempts add column if not exists elapsed_ms integer;

-- 실시간 퀴즈 답 (문제 하나 풀 때마다 한 줄 → 레이스에서 한 칸 이동). 기록은 answer_live 함수만
create table if not exists public.live_answers (
  quiz_id     bigint not null references public.quizzes (id) on delete cascade,
  question_id bigint not null references public.quiz_questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  answer      text not null,
  correct     boolean not null,
  answered_at timestamptz not null default now(),
  primary key (question_id, user_id)                         -- 한 문제에 한 번만
);

create index if not exists live_answers_quiz_id_idx on public.live_answers (quiz_id, answered_at);


-- ---------------------------------------------------------------------
-- 6-8. post_likes : 글 공감 (한 사람이 글 하나에 한 번)
-- ---------------------------------------------------------------------
create table if not exists public.post_likes (
  post_id    bigint not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);


-- ---------------------------------------------------------------------
-- 6-9. 1인1역
--      jobs            : 역할 (선생님이 만듦)
--      job_assignments : 학생별 역할 (한 학생에 하나)
--      job_checks      : "오늘 했어요" 기록 (날짜별)
-- ---------------------------------------------------------------------
create table if not exists public.jobs (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 30),               -- 역할 이름 (예: 칠판 지우기)
  description text check (description is null or char_length(description) <= 200),   -- 하는 일 (선택)
  created_at  timestamptz not null default now()
);

create table if not exists public.job_assignments (
  user_id    uuid primary key references public.profiles (id) on delete cascade,       -- 학생 (한 명에 역할 하나)
  job_id     bigint not null references public.jobs (id) on delete cascade,             -- 역할 (지우면 배정도 지워짐)
  updated_at timestamptz not null default now()
);

create table if not exists public.job_checks (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  check_date date not null default ((now() at time zone 'Asia/Seoul')::date),            -- 한 날짜 (한국 시간)
  created_at timestamptz not null default now(),
  primary key (user_id, check_date)
);


-- ---------------------------------------------------------------------
-- 6-10. events : 학급 일정 (홈 캘린더, 선생님이 입력)
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  event_date date not null,
  title      text not null check (char_length(title) between 1 and 50),
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (event_date);


-- ---------------------------------------------------------------------
-- 6-11. points : 칭찬·활동 점수 (선생님만 주고, 선생님만 봄)
-- ---------------------------------------------------------------------
create table if not exists public.points (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  points     integer not null check (points between -100 and 100 and points <> 0),   -- 줄 점수 (빼기도 가능)
  reason     text check (reason is null or char_length(reason) <= 100),                 -- 이유 (선택)
  created_at timestamptz not null default now()
);

create index if not exists points_user_id_idx on public.points (user_id);


-- ---------------------------------------------------------------------
-- 6-12. 자리 뽑기 (선생님만)
--       seat_rules : "같은 모둠 금지" 묶음 (묶음 안의 학생끼리는 같은 모둠이 되지 않음)
--       seat_draws : 저장한 자리 배치 기록 (모둠별 학생 목록)
-- ---------------------------------------------------------------------
create table if not exists public.seat_rules (
  id         bigint generated always as identity primary key,
  member_ids uuid[] not null check (array_length(member_ids, 1) between 2 and 12),   -- 서로 떨어져야 하는 학생들
  note       text check (note is null or char_length(note) <= 50),                     -- 메모 (선택)
  created_at timestamptz not null default now()
);

create table if not exists public.seat_draws (
  id         bigint generated always as identity primary key,
  group_size smallint not null check (group_size between 2 and 8),                     -- 모둠 크기
  groups     jsonb not null,                                                            -- [[학생ID, ...], [학생ID, ...], ...]
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6-13. content_files : 오늘의 수업·급식에 붙인 사진/파일 (선생님만 올림)
--       실제 파일은 보관함 "attachments" 의 admin/수업또는급식/번호/… 에 있음
-- ---------------------------------------------------------------------
create table if not exists public.content_files (
  id         bigint generated always as identity primary key,
  lesson_id  bigint references public.lessons (id) on delete cascade,   -- 수업 자료면 수업 번호
  meal_id    bigint references public.meals (id) on delete cascade,     -- 급식 자료면 급식 번호
  path       text not null unique,                                      -- 보관 위치
  name       text not null check (char_length(name) between 1 and 200), -- 원래 파일 이름
  size       integer not null check (size between 1 and 52428800),     -- 50MB까지
  mime       text not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(lesson_id, meal_id) = 1)                          -- 수업이나 급식 중 하나에만 붙음
);

create index if not exists content_files_lesson_idx on public.content_files (lesson_id);
create index if not exists content_files_meal_idx on public.content_files (meal_id);

-- 사진만 올려도 되도록 수업 내용·급식 메뉴 글은 선택으로 바꿈
alter table public.lessons alter column content drop not null;
alter table public.lessons drop constraint if exists lessons_content_check;
alter table public.lessons add constraint lessons_content_check check (content is null or char_length(content) between 1 and 2000);
alter table public.meals alter column menu drop not null;
alter table public.meals drop constraint if exists meals_menu_check;
alter table public.meals add constraint meals_menu_check check (menu is null or char_length(menu) between 1 and 1000);


-- ---------------------------------------------------------------------
-- 6-14. access_logs : 접속 기록 (누가, 언제, 어느 IP에서) — 선생님만 봄, 1년 지나면 자동 삭제
--       기록은 log_visit 함수만 (학생이 직접 쓰거나 지울 수 없음)
-- ---------------------------------------------------------------------
create table if not exists public.access_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete cascade,
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists access_logs_created_idx on public.access_logs (created_at desc);


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

-- Google 계정으로 가입한 경우 그 이메일 (선생님만 봄, 승인할 때 확인용)
alter table public.student_names add column if not exists email text check (email is null or char_length(email) <= 200);


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

-- posts : 보드 글이면 주제(topic_id)도 함께 쓸 수 있음 (나중에 주제를 바꿀 수는 없음)
grant insert (topic_id) on public.posts to authenticated;

-- topics, quizzes, quiz_questions, quiz_keys : 권한은 열어 두되, 실제로는 아래 RLS가 관리자만 쓰게 함
revoke all on public.topics, public.quizzes, public.quiz_questions, public.quiz_keys from anon, authenticated;
grant select, insert, update, delete on public.topics, public.quizzes, public.quiz_questions, public.quiz_keys to authenticated;

-- live_answers : 읽기와 (관리자) 지우기만. 기록은 answer_live 함수만
revoke all on public.live_answers from anon, authenticated;
grant select, delete on public.live_answers to authenticated;

-- quiz_starts : 읽기와 (관리자) 지우기만. 기록은 start_quiz 함수만
revoke all on public.quiz_starts from anon, authenticated;
grant select, delete on public.quiz_starts to authenticated;

-- quiz_attempts : 읽기와 (관리자) 지우기만. 기록은 채점 함수 submit_quiz 만 할 수 있음
revoke all on public.quiz_attempts from anon, authenticated;
grant select, delete on public.quiz_attempts to authenticated;

-- post_likes : 읽기, 공감(어느 글인지만), 공감 취소
revoke all on public.post_likes from anon, authenticated;
grant select, delete on public.post_likes to authenticated;
grant insert (post_id) on public.post_likes to authenticated;

-- jobs, job_assignments, events, points : 권한은 열어 두되, 아래 RLS가 관리자만 쓰게(points는 읽기도) 함
revoke all on public.jobs, public.job_assignments, public.events, public.points from anon, authenticated;
grant select, insert, update, delete on public.jobs, public.job_assignments, public.events, public.points to authenticated;

-- seat_rules, seat_draws : 선생님만 (아래 RLS)
revoke all on public.seat_rules, public.seat_draws from anon, authenticated;
grant select, insert, update, delete on public.seat_rules, public.seat_draws to authenticated;

-- access_logs : 선생님만 읽고 지우기 (아래 RLS). 기록은 log_visit 함수만
revoke all on public.access_logs from anon, authenticated;
grant select, delete on public.access_logs to authenticated;

-- content_files : 읽기는 로그인한 사람, 쓰기는 아래 RLS가 관리자만
revoke all on public.content_files from anon, authenticated;
grant select, insert, delete on public.content_files to authenticated;

-- site_settings : 닫힘 여부와 안내 문구는 로그인 전에도 읽음 (닫힘 화면을 띄우려고). 바꾸기는 관리자만
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant update (closed, notice, updated_at) on public.site_settings to authenticated;

-- job_checks : 읽기, "오늘 했어요" 체크와 취소
revoke all on public.job_checks from anon, authenticated;
grant select, delete on public.job_checks to authenticated;
grant insert (user_id, check_date) on public.job_checks to authenticated;

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
alter table public.topics enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_keys enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_starts enable row level security;
alter table public.live_answers enable row level security;
alter table public.post_likes enable row level security;
alter table public.jobs enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_checks enable row level security;
alter table public.events enable row level security;
alter table public.points enable row level security;
alter table public.seat_rules enable row level security;
alter table public.seat_draws enable row level security;
alter table public.content_files enable row level security;
alter table public.site_settings enable row level security;
alter table public.access_logs enable row level security;

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

-- 보드 글은 열려 있는 주제에만 (마감된 주제는 관리자만)
drop policy if exists "posts: 내 이름으로만 쓰기" on public.posts;
create policy "posts: 내 이름으로만 쓰기" on public.posts
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      topic_id is null
      or exists (select 1 from public.topics t where t.id = topic_id and t.is_open)
      or (select public.is_admin())
    )
  );

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

-- ---- topics, quizzes, quiz_questions : 로그인하면 읽기, 관리자만 쓰기 ----
drop policy if exists "topics: 로그인하면 읽기" on public.topics;
create policy "topics: 로그인하면 읽기" on public.topics
  for select to authenticated using (true);
drop policy if exists "topics: 관리자만 쓰고 고치고 지우기" on public.topics;
create policy "topics: 관리자만 쓰고 고치고 지우기" on public.topics
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "quizzes: 로그인하면 읽기" on public.quizzes;
create policy "quizzes: 로그인하면 읽기" on public.quizzes
  for select to authenticated using (true);
drop policy if exists "quizzes: 관리자만 쓰고 고치고 지우기" on public.quizzes;
create policy "quizzes: 관리자만 쓰고 고치고 지우기" on public.quizzes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- 문제는 관리자, "시작"을 누른 학생(혼자 풀기), 선생님이 시작한 실시간 퀴즈에서만 읽기 (미리 보기 방지)
drop policy if exists "quiz_questions: 로그인하면 읽기" on public.quiz_questions;
drop policy if exists "quiz_questions: 시작한 사람과 관리자만 읽기" on public.quiz_questions;
create policy "quiz_questions: 시작한 사람과 관리자만 읽기" on public.quiz_questions
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.quiz_starts s where s.quiz_id = quiz_questions.quiz_id and s.user_id = (select auth.uid()))
    or exists (select 1 from public.quizzes q where q.id = quiz_questions.quiz_id and q.mode = 'live' and q.live_status <> 'waiting')
  );

-- ---- live_answers : 내 답과 관리자만 읽기, 관리자만 지우기(다시 하기) ----
drop policy if exists "live_answers: 내 것 또는 관리자만 읽기" on public.live_answers;
create policy "live_answers: 내 것 또는 관리자만 읽기" on public.live_answers
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "live_answers: 관리자만 지우기" on public.live_answers;
create policy "live_answers: 관리자만 지우기" on public.live_answers
  for delete to authenticated
  using ((select public.is_admin()));

-- ---- quiz_starts : 내 것과 관리자만 읽기, 관리자만 지우기(다시 풀게 하기) ----
drop policy if exists "quiz_starts: 내 것 또는 관리자만 읽기" on public.quiz_starts;
create policy "quiz_starts: 내 것 또는 관리자만 읽기" on public.quiz_starts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "quiz_starts: 관리자만 지우기" on public.quiz_starts;
create policy "quiz_starts: 관리자만 지우기" on public.quiz_starts
  for delete to authenticated
  using ((select public.is_admin()));
drop policy if exists "quiz_questions: 관리자만 쓰고 고치고 지우기" on public.quiz_questions;
create policy "quiz_questions: 관리자만 쓰고 고치고 지우기" on public.quiz_questions
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- quiz_keys : 정답은 관리자만 (학생은 읽기도 안 됨) ----
drop policy if exists "quiz_keys: 관리자만" on public.quiz_keys;
create policy "quiz_keys: 관리자만" on public.quiz_keys
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- quiz_attempts : 내 답안·점수는 나만, 전체는 관리자만. 지우기(다시 풀게 하기)는 관리자만 ----
drop policy if exists "quiz_attempts: 내 것 또는 관리자만 읽기" on public.quiz_attempts;
create policy "quiz_attempts: 내 것 또는 관리자만 읽기" on public.quiz_attempts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "quiz_attempts: 관리자만 지우기" on public.quiz_attempts;
create policy "quiz_attempts: 관리자만 지우기" on public.quiz_attempts
  for delete to authenticated
  using ((select public.is_admin()));

-- ---- post_likes : 누구나 보기, 내 이름으로만 공감·취소 ----
drop policy if exists "post_likes: 로그인하면 읽기" on public.post_likes;
create policy "post_likes: 로그인하면 읽기" on public.post_likes
  for select to authenticated using (true);
drop policy if exists "post_likes: 내 공감만 누르기" on public.post_likes;
create policy "post_likes: 내 공감만 누르기" on public.post_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "post_likes: 내 공감만 취소" on public.post_likes;
create policy "post_likes: 내 공감만 취소" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---- jobs, job_assignments, events : 로그인하면 읽기, 관리자만 쓰기 ----
drop policy if exists "jobs: 로그인하면 읽기" on public.jobs;
create policy "jobs: 로그인하면 읽기" on public.jobs
  for select to authenticated using (true);
drop policy if exists "jobs: 관리자만 쓰고 고치고 지우기" on public.jobs;
create policy "jobs: 관리자만 쓰고 고치고 지우기" on public.jobs
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "job_assignments: 로그인하면 읽기" on public.job_assignments;
create policy "job_assignments: 로그인하면 읽기" on public.job_assignments
  for select to authenticated using (true);
drop policy if exists "job_assignments: 관리자만 쓰고 고치고 지우기" on public.job_assignments;
create policy "job_assignments: 관리자만 쓰고 고치고 지우기" on public.job_assignments
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "events: 로그인하면 읽기" on public.events;
create policy "events: 로그인하면 읽기" on public.events
  for select to authenticated using (true);
drop policy if exists "events: 관리자만 쓰고 고치고 지우기" on public.events;
create policy "events: 관리자만 쓰고 고치고 지우기" on public.events
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- job_checks : 누구나 현황 보기. 학생은 "오늘" 내 것만 체크·취소, 관리자는 누구 것이든 ----
drop policy if exists "job_checks: 로그인하면 읽기" on public.job_checks;
create policy "job_checks: 로그인하면 읽기" on public.job_checks
  for select to authenticated using (true);
drop policy if exists "job_checks: 오늘 내 것만 체크 (관리자는 모두)" on public.job_checks;
create policy "job_checks: 오늘 내 것만 체크 (관리자는 모두)" on public.job_checks
  for insert to authenticated
  with check (
    (user_id = (select auth.uid()) and check_date = (now() at time zone 'Asia/Seoul')::date)
    or (select public.is_admin())
  );
drop policy if exists "job_checks: 오늘 내 것만 취소 (관리자는 모두)" on public.job_checks;
create policy "job_checks: 오늘 내 것만 취소 (관리자는 모두)" on public.job_checks
  for delete to authenticated
  using (
    (user_id = (select auth.uid()) and check_date = (now() at time zone 'Asia/Seoul')::date)
    or (select public.is_admin())
  );

-- ---- points : 관리자만 (학생은 자기 점수도 못 읽음) ----
drop policy if exists "points: 관리자만" on public.points;
create policy "points: 관리자만" on public.points
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- seat_rules, seat_draws : 관리자만 (학생은 읽기도 안 됨) ----
drop policy if exists "seat_rules: 관리자만" on public.seat_rules;
create policy "seat_rules: 관리자만" on public.seat_rules
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "seat_draws: 관리자만" on public.seat_draws;
create policy "seat_draws: 관리자만" on public.seat_draws
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- content_files : 로그인하면 읽기, 관리자만 올리고 지우기 ----
drop policy if exists "content_files: 로그인하면 읽기" on public.content_files;
create policy "content_files: 로그인하면 읽기" on public.content_files
  for select to authenticated using (true);
drop policy if exists "content_files: 관리자만 쓰고 지우기" on public.content_files;
create policy "content_files: 관리자만 쓰고 지우기" on public.content_files
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- access_logs : 선생님만 읽고 지우기 ----
drop policy if exists "access_logs: 관리자만" on public.access_logs;
create policy "access_logs: 관리자만" on public.access_logs
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- site_settings : 누구나 읽기(닫힘 화면용), 관리자만 바꾸기 ----
drop policy if exists "site_settings: 누구나 읽기" on public.site_settings;
create policy "site_settings: 누구나 읽기" on public.site_settings
  for select to anon, authenticated using (true);
drop policy if exists "site_settings: 관리자만 바꾸기" on public.site_settings;
create policy "site_settings: 관리자만 바꾸기" on public.site_settings
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

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

-- 선생님: 수업·급식 자료는 admin/… 폴더에 올리기
drop policy if exists "attachments: 관리자 자료 올리기" on storage.objects;
create policy "attachments: 관리자 자료 올리기" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'admin'
    and (select public.is_admin())
  );

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
-- 9-2. 이용 잠금 : 선생님이거나, (사이트가 열려 있고 + 승인된 학생)만 모든 표와 파일 사용
--      → 사이트가 닫히면(site_settings.closed) 학생은 전부 막힘
--      → 회원가입 후 승인 대기(pending)인 학생도 전부 막힘 (자기 profiles 줄만 볼 수 있음)
--      "restrictive"(추가 잠금) 규칙이라 위의 다른 규칙을 통과해도 여기서 한 번 더 막힘.
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'posts', 'lessons', 'homework', 'meals', 'post_files', 'comments', 'topics',
    'quizzes', 'quiz_questions', 'quiz_keys', 'quiz_attempts', 'quiz_starts', 'live_answers',
    'post_likes', 'jobs', 'job_assignments', 'job_checks', 'events', 'points',
    'seat_rules', 'seat_draws', 'content_files', 'student_names', 'access_logs'
  ] loop
    execute format('drop policy if exists "닫힘 잠금" on public.%I', t);
    execute format(
      'create policy "닫힘 잠금" on public.%I as restrictive for all to authenticated '
      'using ((select public.can_use())) '
      'with check ((select public.can_use()))',
      t
    );
  end loop;
end;
$$;

-- profiles: 승인 대기 학생도 자기 줄(승인 상태 확인용)은 볼 수 있음
drop policy if exists "닫힘 잠금" on public.profiles;
create policy "닫힘 잠금" on public.profiles
  as restrictive for all to authenticated
  using ((select public.can_use()) or id = (select auth.uid()))
  with check ((select public.can_use()) or id = (select auth.uid()));

drop policy if exists "attachments: 닫힘 잠금" on storage.objects;
create policy "attachments: 닫힘 잠금" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'attachments' or (select public.can_use()))
  with check (bucket_id <> 'attachments' or (select public.can_use()));


-- =====================================================================
-- 10. 퀴즈 함수 (정답을 학생에게 보여 주지 않고 서버에서 채점)
-- =====================================================================

-- 답 비교용: 띄어쓰기 없애고 소문자로 ("서울 특별시" = "서울특별시")
create or replace function public.quiz_normalize(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(value, ''), '\s', '', 'g'));
$$;

-- 시작하기: 서버 시각으로 시작 기록 (이미 시작했으면 처음 시각 그대로). 제한 시간 계산용 정보를 돌려줌
create or replace function public.start_quiz(p_quiz_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_started timestamptz;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.can_use() then
    raise exception '사이트가 닫혀 있어요.';
  end if;
  select time_limit_sec into v_limit from public.quizzes where id = p_quiz_id and is_open and mode = 'self';
  if not found then
    raise exception '닫혔거나 없는 퀴즈예요.';
  end if;
  if exists (select 1 from public.quiz_attempts where quiz_id = p_quiz_id and user_id = v_uid) then
    raise exception '이미 참여한 퀴즈예요.';
  end if;
  insert into public.quiz_starts (quiz_id, user_id) values (p_quiz_id, v_uid)
  on conflict (quiz_id, user_id) do nothing;
  select started_at into v_started from public.quiz_starts where quiz_id = p_quiz_id and user_id = v_uid;
  return jsonb_build_object('started_at', v_started, 'server_now', now(), 'time_limit_sec', v_limit);
end;
$$;

-- 제출하고 채점하기: 한 사람 한 번, 열린 퀴즈만, 시작한 뒤에만.
-- 제한 시간이 있으면 (제한 시간 + 30초 여유) 안에 내야 함. 결과(점수·정답·걸린 시간)를 돌려줌
create or replace function public.submit_quiz(p_quiz_id bigint, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := 0;
  v_total int := 0;
  v_given text;
  v_ok boolean;
  v_results jsonb := '[]'::jsonb;
  v_started timestamptz;
  v_limit int;
  v_elapsed int;
  q record;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.can_use() then
    raise exception '사이트가 닫혀 있어요.';
  end if;
  if not exists (select 1 from public.quizzes where id = p_quiz_id and is_open and mode = 'self') then
    raise exception '닫혔거나 없는 퀴즈예요.';
  end if;
  if exists (select 1 from public.quiz_attempts where quiz_id = p_quiz_id and user_id = v_uid) then
    raise exception '이미 참여한 퀴즈예요.';
  end if;
  select started_at into v_started from public.quiz_starts where quiz_id = p_quiz_id and user_id = v_uid;
  if v_started is null then
    raise exception '먼저 시작을 눌러 주세요.';
  end if;
  select time_limit_sec into v_limit from public.quizzes where id = p_quiz_id;
  v_elapsed := floor(extract(epoch from (now() - v_started)) * 1000)::int;
  if v_limit is not null and v_elapsed > (v_limit + 30) * 1000 then
    raise exception '제한 시간이 지났어요.';
  end if;

  for q in
    select qq.id, k.answer
    from public.quiz_questions qq
    join public.quiz_keys k on k.question_id = qq.id
    where qq.quiz_id = p_quiz_id
    order by qq.position, qq.id
  loop
    v_total := v_total + 1;
    v_given := left(coalesce(p_answers ->> q.id::text, ''), 200);
    -- 정답이 "서울|서울특별시"처럼 여러 개면 그중 하나만 맞으면 정답
    v_ok := public.quiz_normalize(v_given) <> '' and exists (
      select 1 from unnest(string_to_array(q.answer, '|')) as a(value)
      where public.quiz_normalize(a.value) = public.quiz_normalize(v_given)
    );
    if v_ok then
      v_score := v_score + 1;
    end if;
    v_results := v_results || jsonb_build_object('question_id', q.id, 'given', v_given, 'answer', q.answer, 'correct', v_ok);
  end loop;

  if v_total = 0 then
    raise exception '문제가 없는 퀴즈예요.';
  end if;

  insert into public.quiz_attempts (quiz_id, user_id, answers, score, total, elapsed_ms)
  values (p_quiz_id, v_uid, p_answers, v_score, v_total, least(v_elapsed, coalesce(v_limit * 1000, v_elapsed)));

  return jsonb_build_object('score', v_score, 'total', v_total, 'elapsed_ms', v_elapsed, 'results', v_results);
end;
$$;

-- 정답 보기: 이미 제출한 사람과 관리자만
create or replace function public.quiz_review(p_quiz_id bigint)
returns table (question_id bigint, answer text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.question_id, k.answer
  from public.quiz_keys k
  join public.quiz_questions qq on qq.id = k.question_id
  where qq.quiz_id = p_quiz_id
    and ((select public.can_use()))
    and (
      exists (select 1 from public.quiz_attempts a where a.quiz_id = p_quiz_id and a.user_id = (select auth.uid()))
      or (select public.is_admin())
    );
$$;

-- 참가 현황: 누가 제출했는지만 (점수는 안 알려 줌). 로그인한 사람 누구나
create or replace function public.quiz_participation(p_quiz_id bigint)
returns table (user_id uuid, submitted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, a.created_at
  from public.quiz_attempts a
  where a.quiz_id = p_quiz_id and (select auth.uid()) is not null and ((select public.can_use()));
$$;

-- 빨리 푼 순위: 만점을 받은 사람만, 걸린 시간 순 (점수는 안 알려 줌). 로그인한 사람 누구나
create or replace function public.quiz_speed_ranking(p_quiz_id bigint)
returns table (user_id uuid, elapsed_ms integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, a.elapsed_ms
  from public.quiz_attempts a
  where a.quiz_id = p_quiz_id
    and a.score = a.total
    and a.elapsed_ms is not null
    and (select auth.uid()) is not null and ((select public.can_use()))
  order by a.elapsed_ms;
$$;

revoke execute on function public.start_quiz(bigint), public.submit_quiz(bigint, jsonb), public.quiz_review(bigint), public.quiz_participation(bigint), public.quiz_speed_ranking(bigint) from public, anon;
grant execute on function public.start_quiz(bigint), public.submit_quiz(bigint, jsonb), public.quiz_review(bigint), public.quiz_participation(bigint), public.quiz_speed_ranking(bigint) to authenticated;


-- =====================================================================
-- 10-2. 실시간 퀴즈 함수
--   live_control : 선생님이 시작 / 끝내기 / 다시 하기 (시작 시각은 서버 시각)
--   live_state   : 지금 상태와 서버 시각 (학생·레이스 화면이 남은 시간을 맞추는 데 씀)
--   answer_live  : 학생이 문제 하나 답하기 → 바로 채점 (정답은 알려 주지 않고 맞았는지만)
-- =====================================================================
create or replace function public.live_control(p_quiz_id bigint, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '선생님만 할 수 있어요.';
  end if;
  if not exists (select 1 from public.quizzes where id = p_quiz_id and mode = 'live') then
    raise exception '실시간 퀴즈가 아니에요.';
  end if;
  if p_action = 'start' then
    update public.quizzes set live_status = 'running', live_started_at = now() where id = p_quiz_id;
  elsif p_action = 'end' then
    update public.quizzes set live_status = 'ended' where id = p_quiz_id;
  elsif p_action = 'reset' then
    delete from public.live_answers where quiz_id = p_quiz_id;
    update public.quizzes set live_status = 'waiting', live_started_at = null where id = p_quiz_id;
  else
    raise exception '알 수 없는 동작이에요.';
  end if;
end;
$$;

create or replace function public.live_state(p_quiz_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', case
      when q.live_status = 'running' and q.time_limit_sec is not null
           and now() > q.live_started_at + make_interval(secs => q.time_limit_sec) then 'ended'
      else q.live_status end,
    'started_at', q.live_started_at,
    'server_now', now(),
    'time_limit_sec', q.time_limit_sec,
    'total', (select count(*) from public.quiz_questions qq where qq.quiz_id = q.id)
  )
  from public.quizzes q
  where q.id = p_quiz_id and q.mode = 'live' and (select auth.uid()) is not null and ((select public.can_use()));
$$;

create or replace function public.answer_live(p_question_id bigint, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.quizzes%rowtype;
  v_key text;
  v_given text := left(coalesce(p_answer, ''), 200);
  v_ok boolean;
  v_answered int;
  v_total int;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not public.can_use() then
    raise exception '사이트가 닫혀 있어요.';
  end if;
  select q.* into v_quiz
  from public.quizzes q join public.quiz_questions qq on qq.quiz_id = q.id
  where qq.id = p_question_id;
  if not found or v_quiz.mode <> 'live' then
    raise exception '실시간 퀴즈 문제가 아니에요.';
  end if;
  if v_quiz.live_status <> 'running' then
    raise exception '지금은 풀 수 없어요.';
  end if;
  -- 제한 시간 + 5초 여유
  if v_quiz.time_limit_sec is not null and now() > v_quiz.live_started_at + make_interval(secs => v_quiz.time_limit_sec + 5) then
    raise exception '시간이 끝났어요.';
  end if;

  select answer into v_key from public.quiz_keys where question_id = p_question_id;
  v_ok := public.quiz_normalize(v_given) <> '' and exists (
    select 1 from unnest(string_to_array(v_key, '|')) as a(value)
    where public.quiz_normalize(a.value) = public.quiz_normalize(v_given)
  );

  insert into public.live_answers (quiz_id, question_id, user_id, answer, correct)
  values (v_quiz.id, p_question_id, v_uid, v_given, coalesce(v_ok, false))
  on conflict (question_id, user_id) do nothing;
  if not found then
    raise exception '이미 답한 문제예요.';
  end if;

  select count(*) into v_answered from public.live_answers where quiz_id = v_quiz.id and user_id = v_uid;
  select count(*) into v_total from public.quiz_questions where quiz_id = v_quiz.id;
  return jsonb_build_object('correct', coalesce(v_ok, false), 'answered', v_answered, 'total', v_total);
end;
$$;

revoke execute on function public.live_control(bigint, text), public.live_state(bigint), public.answer_live(bigint, text) from public, anon;
grant execute on function public.live_control(bigint, text), public.live_state(bigint), public.answer_live(bigint, text) to authenticated;

-- 실시간 알림(Supabase Realtime): 퀴즈 상태와 답이 바뀌면 화면에 바로 알림
-- (Realtime이 꺼져 있어도 화면은 2~3초마다 새로 확인하므로 동작함)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_answers') then
      alter publication supabase_realtime add table public.live_answers;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quizzes') then
      alter publication supabase_realtime add table public.quizzes;
    end if;
  end if;
end;
$$;


-- =====================================================================
-- 10-3. 회원 관리와 접속 기록
--   set_member_status : 선생님이 가입 요청 승인 (pending → approved) 또는 승인 취소
--   remove_member     : 선생님이 학생 계정 삭제 (가입 거절도 이것으로). 관리자 계정은 못 지움
--   log_visit         : 로그인한 사람의 접속 기록 (IP는 서버가 받은 요청 정보에서 읽음)
-- =====================================================================
create or replace function public.set_member_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '선생님만 할 수 있어요.';
  end if;
  if p_status not in ('pending', 'approved') then
    raise exception '알 수 없는 상태예요.';
  end if;
  -- 개인정보 동의를 하지 않은 계정은 승인할 수 없음
  if p_status = 'approved' and exists (select 1 from public.profiles where id = p_user_id and privacy_agreed_at is null and status = 'pending') then
    raise exception '아직 개인정보 동의를 하지 않은 계정이에요.';
  end if;
  update public.profiles set status = p_status where id = p_user_id and role = 'student';
end;
$$;

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception '선생님만 할 수 있어요.';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and role = 'admin') then
    raise exception '관리자 계정은 지울 수 없어요.';
  end if;
  delete from auth.users where id = p_user_id; -- profiles·글·댓글 등도 함께 지워짐
end;
$$;

create or replace function public.log_visit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers json;
  v_ip text;
begin
  if auth.uid() is null then
    return;
  end if;
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers ->> 'cf-connecting-ip', trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), v_headers ->> 'x-real-ip');
  insert into public.access_logs (user_id, ip, user_agent)
  values (auth.uid(), left(nullif(v_ip, ''), 64), left(v_headers ->> 'user-agent', 300));
  delete from public.access_logs where created_at < now() - interval '1 year';
end;
$$;

-- Google로 처음 들어온 학생: 두 가지 동의 + 아이디·이름 정하기 → 가입 요청 완료 (승인 대기)
create or replace function public.complete_signup(p_username text, p_real_name text, p_privacy_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_name text := trim(coalesce(p_real_name, ''));
begin
  if v_uid is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'pending' and privacy_agreed_at is null) then
    raise exception '이미 가입 요청을 보냈어요.';
  end if;
  if v_username !~ '^[a-z0-9_]{2,30}$' or v_username like 'g\_%' then
    raise exception '아이디는 영어 소문자·숫자·_ 2~30자로 해 주세요. (g_ 로 시작할 수 없어요)';
  end if;
  if exists (select 1 from public.profiles where username = v_username and id <> v_uid) then
    raise exception '이미 있는 아이디예요.';
  end if;
  if char_length(v_name) not between 1 and 20 then
    raise exception '이름을 써 주세요. (20자 이내)';
  end if;
  if coalesce(p_privacy_version, '') = '' then
    raise exception '두 가지 동의가 필요해요.';
  end if;

  update public.profiles
  set username = v_username, privacy_agreed_at = now(), privacy_version = left(p_privacy_version, 30)
  where id = v_uid;

  insert into public.student_names (user_id, real_name)
  values (v_uid, v_name)
  on conflict (user_id) do update set real_name = excluded.real_name, updated_at = now();
end;
$$;

-- 동의하지 않으면: 아직 승인 대기인 내 계정을 스스로 지움 (Google 정보도 함께 지워짐)
create or replace function public.cancel_signup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요해요.';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'pending' and role = 'student') then
    raise exception '승인 대기 중인 계정만 스스로 지울 수 있어요.';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.complete_signup(text, text, text), public.cancel_signup() from public, anon;
grant execute on function public.complete_signup(text, text, text), public.cancel_signup() to authenticated;

revoke execute on function public.set_member_status(uuid, text), public.remove_member(uuid), public.log_visit() from public, anon;
grant execute on function public.set_member_status(uuid, text), public.remove_member(uuid), public.log_visit() to authenticated;


-- =====================================================================
-- 11. 순위 함수 : 학생에게는 "등수"만 알려 줌 (점수 숫자는 안 알려 줌)
--     같은 점수는 같은 등수. 점수 기록이 없는 학생은 0점으로 계산
-- =====================================================================
create or replace function public.points_ranking()
returns table (user_id uuid, rank bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, rank() over (order by coalesce(sum(pt.points), 0) desc)
  from public.profiles p
  left join public.points pt on pt.user_id = p.id
  where p.role = 'student' and p.status = 'approved' and (select auth.uid()) is not null and ((select public.can_use()))
  group by p.id;
$$;

revoke execute on function public.points_ranking() from public, anon;
grant execute on function public.points_ranking() to authenticated;


-- =====================================================================
-- 끝! 이제 Authentication → Users 에서 계정을 만든 뒤,
-- supabase/make-admin.sql 을 실행해 redsionkim 을 관리자로 지정하세요.
-- =====================================================================
