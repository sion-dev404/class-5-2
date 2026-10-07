-- =====================================================================
-- 긴급: 학생에게 사이트 닫기 + 학생 로그인 모두 끊기 (계정 도용 등 사고 때)
--
-- 사용법: Supabase → SQL Editor → 이 파일 전체를 붙여넣고 Run
--   · 배포 없이 바로 효과가 있습니다. (DB가 학생의 모든 접근을 막음)
--   · 선생님(관리자) 계정은 그대로 쓸 수 있습니다.
--   · 다시 열 때는 누리집 "관리 → 사이트"에서 열거나, 맨 아래 주석의 SQL을 실행하세요.
-- =====================================================================

-- 1) 사이트 닫기 (안내 문구도 함께)
update public.site_settings
set closed = true,
    notice = '도용 사건으로 사이트가 종료되었습니다.',
    updated_at = now()
where id = 1;

-- 2) 학생 계정의 로그인(세션) 모두 끊기 → 다시 로그인해야 함
--    (도용한 사람이 로그인해 둔 상태여도 끊김. 선생님 계정은 그대로)
delete from auth.sessions
where user_id in (select id from public.profiles where role = 'student');

-- 3) 확인: 닫힘 상태, 아직 남아 있는 로그인(선생님 것만 있어야 정상)
select closed as 닫힘, notice as 안내문구, updated_at as 바꾼시각 from public.site_settings;

select p.username as 아이디, p.role as 역할, s.ip as IP주소, s.updated_at as 마지막사용
from auth.sessions s
join public.profiles p on p.id = s.user_id
order by s.updated_at desc;

-- ---------------------------------------------------------------------
-- 다시 열기 (사고 정리 후):
-- update public.site_settings set closed = false, updated_at = now() where id = 1;
--
-- 도용된 학생 계정은 Authentication → Users 에서 비밀번호를 새로 바꿔 주세요.
-- ---------------------------------------------------------------------
