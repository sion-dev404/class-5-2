-- =====================================================================
-- ⚠️ 관리자를 뺀 모든 계정 지우기 (회원가입 방식으로 새로 시작할 때)
--
-- 되돌릴 수 없습니다! 학생 계정과 함께 그 학생이 쓴 글·댓글·공감·퀴즈 기록·실명·접속 기록이
-- 모두 지워집니다. 선생님(관리자) 계정과 선생님이 쓴 글·수업·숙제·급식·퀴즈는 남습니다.
--
-- 사용법: Supabase → SQL Editor → 이 파일 전체를 붙여넣고 Run
--   1) 먼저 맨 위 "지울 계정 미리 보기" 결과를 확인하세요.
--   2) 관리자가 한 명도 없으면 아무것도 지우지 않고 멈춥니다. (잠기는 사고 방지)
-- =====================================================================

-- 1) 지울 계정 미리 보기
select coalesce(p.username, u.email) as 지울_계정, coalesce(p.role, '(profiles 없음)') as 역할
from auth.users u
left join public.profiles p on p.id = u.id
where coalesce(p.role, '') <> 'admin'
order by 1;

-- 2) 관리자 확인 후 지우기
do $$
declare
  v_admins int;
  v_deleted int;
begin
  select count(*) into v_admins from public.profiles where role = 'admin';
  if v_admins = 0 then
    raise exception '관리자 계정이 없어요! 지우지 않고 멈춥니다. make-admin.sql 을 먼저 확인하세요.';
  end if;

  delete from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id and p.role = 'admin');
  get diagnostics v_deleted = row_count;
  raise notice '관리자 %명은 남기고 계정 %개를 지웠어요.', v_admins, v_deleted;
end;
$$;

-- 3) 결과 확인: 관리자만 남아 있으면 정상
select username as 남은_계정, role as 역할, status as 상태 from public.profiles order by username;

-- ---------------------------------------------------------------------
-- 참고: 지운 학생이 게시판에 올렸던 사진·파일의 기록은 지워졌지만, 실제 파일은
-- Storage → attachments 보관함에 남아 있을 수 있어요. (Supabase는 SQL로 파일 삭제를 막음)
-- 필요하면 Storage 화면에서 'admin' 폴더를 뺀 나머지 폴더를 지우세요.
-- ---------------------------------------------------------------------
