-- =====================================================================
-- redsionkim 계정을 관리자로 지정하기
--
-- 사용법: schema.sql 실행 → Authentication → Users 에서
--         redsionkim@class52.local 계정을 만든 다음, 이 파일을 SQL Editor에서 Run
-- =====================================================================

-- 1) redsionkim 의 역할을 관리자(admin)로 바꾸기
update public.profiles
set role = 'admin'
where username = 'redsionkim';

-- 2) 결과 확인 : 모든 계정의 아이디와 역할을 보여 줍니다.
--    redsionkim 만 admin, 나머지는 student 이면 성공입니다.
select username, nickname, role, created_at
from public.profiles
order by role, username;
