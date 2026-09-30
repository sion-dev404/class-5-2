-- =====================================================================
-- 관리자 지정하기 : redsionkim, teacher0502
--
-- 사용법: schema.sql 실행 → Authentication → Users 에서 계정을 모두 만든 다음,
--         이 파일 전체를 SQL Editor에 붙여넣고 Run (여러 번 실행해도 괜찮음)
-- =====================================================================

-- 1) 두 계정을 관리자(admin)로 바꾸기
update public.profiles
set role = 'admin'
where username in ('redsionkim', 'teacher0502');

-- 2) 혹시 다른 계정이 관리자로 되어 있으면 학생으로 되돌리기
update public.profiles
set role = 'student'
where username not in ('redsionkim', 'teacher0502')
  and role = 'admin';

-- 3) 결과 확인 : 관리자 2명이 맨 위, 그 아래 학생들
--    학생은 s01 ~ s25 중 s15를 뺀 24명이면 정상입니다.
select username as 아이디, role as 역할, nickname as 별명
from public.profiles
order by role, username;
