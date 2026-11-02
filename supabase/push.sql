-- =====================================================================
-- 푸시 알림 (안드로이드 앱) — SQL Editor 에서 한 번 실행 (여러 번 실행해도 안전)
--   새 댓글·공감 → 글쓴이에게, 새 글 → 승인된 모두에게 (쓴 사람 제외)
--   실제 발송은 Supabase Edge Function(send-push)이 하고, 여기서는 호출만 함
-- 실행 전: scripts/setup-push.ps1 을 먼저 실행해서 함수를 올려 두세요.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- 알림을 받을 기기 (FCM 토큰). 직접 쓰지 못하고 아래 함수로만 등록
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- 발송 함수 주소·비밀 값 (아무도 못 읽음. 함수 안에서만 읽음)
create table if not exists public.push_config (
  id     int primary key check (id = 1),
  url    text not null,
  secret text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.save_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_token is null or char_length(p_token) not between 20 and 4096 then
    return;
  end if;
  insert into public.push_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
end;
$$;

-- 로그아웃: 내 기기 토큰 지우기
create or replace function public.remove_push_tokens()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where user_id = auth.uid();
$$;

revoke execute on function public.save_push_token(text), public.remove_push_tokens() from public, anon;
grant execute on function public.save_push_token(text), public.remove_push_tokens() to authenticated;

-- 알림 보내기 (실패해도 글·댓글 쓰기는 절대 막히지 않음)
create or replace function public.send_push(p_user_ids uuid[], p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.push_config;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return;
  end if;
  select * into v_config from public.push_config where id = 1;
  if not found then
    return;
  end if;
  perform net.http_post(
    url := v_config.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_config.secret),
    body := jsonb_build_object('user_ids', p_user_ids, 'title', p_title, 'body', p_body, 'url', p_url)
  );
exception when others then
  null;
end;
$$;
revoke execute on function public.send_push(uuid[], text, text, text) from public, anon, authenticated;

create or replace function public.push_name(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select coalesce(nickname, username) from public.profiles where id = p_user;
$$;
revoke execute on function public.push_name(uuid) from public, anon, authenticated;

-- 새 댓글 → 글쓴이
create or replace function public.push_on_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  select * into v_post from public.posts where id = new.post_id;
  if found and v_post.author_id <> new.author_id then
    perform public.send_push(array[v_post.author_id], '새 댓글', public.push_name(new.author_id) || '님이 "' || left(v_post.title, 20) || '" 글에 댓글을 남겼어요.', case when v_post.topic_id is null then '#/board/' || v_post.id else '#/topics/' || v_post.topic_id end);
  end if;
  return new;
end;
$$;

-- 새 공감 → 글쓴이
create or replace function public.push_on_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  select * into v_post from public.posts where id = new.post_id;
  if found and v_post.author_id <> new.user_id then
    perform public.send_push(array[v_post.author_id], '공감 ♥', public.push_name(new.user_id) || '님이 "' || left(v_post.title, 20) || '" 글에 공감했어요.', case when v_post.topic_id is null then '#/board/' || v_post.id else '#/topics/' || v_post.topic_id end);
  end if;
  return new;
end;
$$;

-- 새 글 → 승인된 모두 (쓴 사람 제외, 알림을 켠 기기가 있는 사람만)
create or replace function public.push_on_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(distinct t.user_id) into v_ids
  from public.push_tokens t
  join public.profiles p on p.id = t.user_id
  where t.user_id <> new.author_id and (p.status = 'approved' or p.role = 'admin');
  perform public.send_push(v_ids, case when new.topic_id is null then '게시판 새 글' else '보드 새 글' end, public.push_name(new.author_id) || ': ' || left(new.title, 30), case when new.topic_id is null then '#/board/' || new.id else '#/topics/' || new.topic_id end);
  return new;
end;
$$;

drop trigger if exists push_comment on public.comments;
create trigger push_comment after insert on public.comments for each row execute function public.push_on_comment();
drop trigger if exists push_like on public.post_likes;
create trigger push_like after insert on public.post_likes for each row execute function public.push_on_like();
drop trigger if exists push_post on public.posts;
create trigger push_post after insert on public.posts for each row execute function public.push_on_post();
