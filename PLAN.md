# 5학년 2반 학급 누리집 설계 (PLAN)

> 이 문서는 **설계만** 담는다. 코드는 아직 없다.
> 표시: 🧑‍🏫 = 선생님이 직접 할 일, 🤖 = Claude가 코드로 할 일

---

## 1. 전체 구조

```
[브라우저]  ── Vite로 만든 정적 화면 (Netlify에 배포)
    │
    ├─ 로그인 · 게시판 · 수업 · 숙제 ──▶ [Supabase]
    │                                     ├ Auth (로그인)
    │                                     ├ Postgres DB + RLS (보안 규칙)
    │                                     └ Edge Function "meal" (급식 중계)
    │                                               │
    └─ 식단 ──▶ Edge Function "meal" ──────────────▶ [나이스 교육정보 개방 포털 API]
```

| 구성 | 선택 | 이유 |
|---|---|---|
| 화면 | Vite + 순수 JavaScript (프레임워크 없음) | 가볍고, 코드를 읽고 고치기 쉬움 |
| 페이지 이동 | 해시 라우팅 (`#/board`, `#/lessons` …) | Netlify에서 새로고침해도 404가 안 남, 별도 설정 불필요 |
| 로그인 · DB | Supabase 무료 플랜 | Auth + Postgres + RLS를 한 곳에서 |
| 급식 | Supabase Edge Function이 나이스 API를 대신 호출 | 나이스 인증키를 브라우저·GitHub에 노출하지 않음, CORS 문제 회피, Netlify 크레딧 소모 없음 |
| 배포 | Netlify (GitHub 연동) | `git push` 때만 배포 → "올려줘" 할 때만 push |

### 폴더 구조 (예정)
```
class-5-2/
├─ index.html
├─ src/
│  ├─ main.js            # 시작점, 라우터
│  ├─ supabase.js        # Supabase 클라이언트 (공개 키만 사용)
│  ├─ auth.js            # 로그인/로그아웃, 아이디 → 이메일 변환
│  ├─ pages/
│  │  ├─ login.js
│  │  ├─ home.js         # 오늘 수업 · 가까운 숙제 · 오늘 급식 요약
│  │  ├─ board.js
│  │  ├─ lessons.js
│  │  ├─ homework.js
│  │  └─ meal.js
│  └─ style.css
├─ supabase/
│  ├─ schema.sql         # 테이블 + RLS 정책 (SQL Editor에 붙여넣기용, 비밀 없음)
│  └─ functions/meal/index.ts
├─ .env.example          # 변수 이름만, 값 없음
├─ .gitignore            # .env, .env.local 포함
└─ PLAN.md
```

---

## 2. 로그인 설계 (아이디 로그인)

Supabase Auth는 **이메일 + 비밀번호**가 기본이다. 그래서 아이디를 **가짜 이메일로 바꿔서** 로그인한다.

- 학생이 입력: `s01` / 비밀번호
- 코드가 변환: `s01@class52.local` / 비밀번호 → Supabase에 로그인
- `class52.local`은 실제로 메일이 가지 않는 주소다. 메일 발송 기능(비밀번호 찾기 등)은 쓰지 않는다.
  - 비밀번호를 잊으면 🧑‍🏫 선생님이 관리 화면에서 새 비밀번호로 바꿔 준다.

### 아이디 규칙
| 구분 | 아이디 | 로그인 이메일(내부용) |
|---|---|---|
| 관리자(선생님) | `redsionkim` | `redsionkim@class52.local` |
| 학생 | `s01` ~ `s30` (출석번호) | `s01@class52.local` … |

- 학생 아이디에 **실명을 쓰지 않는다** (번호로만).
- 화면에 보이는 이름은 `아이디` 또는 학생이 정한 **별명**(선택). 별명도 실명 금지 안내.

### 관리자/학생 구분
- `profiles` 테이블에 `role` 칸: `'admin'` 또는 `'student'`
- 새 계정이 생기면 DB 트리거가 자동으로 `profiles`에 `student`로 한 줄 만든다.
- 관리자 지정은 🧑‍🏫 SQL 한 줄로 직접 한다 (5장 참고). **학생은 자기 role을 바꿀 수 없다** (RLS로 막음).
- DB 안에 `is_admin()` 함수를 두고 모든 보안 규칙에서 이것으로 관리자를 판단한다.
  → 화면(JS)에서 관리자 버튼을 숨기는 것은 **편의일 뿐**, 실제 차단은 DB가 한다.

### 외부인 차단
- Supabase에서 **"새 사용자 가입 허용(Allow new users to sign up)"을 끈다** → 선생님이 만든 계정만 존재.
- 모든 테이블은 **로그인한 사용자(authenticated)만 읽기 가능**. 로그인 안 한 사람은 화면 틀만 보이고 데이터는 0건.

---

## 3. 비밀 정보 관리 원칙

| 값 | 공개 가능? | 어디에 두나 |
|---|---|---|
| Supabase Project URL | ✅ 공개 가능 | `.env.local`(로컬), Netlify 환경변수 |
| Supabase **anon / publishable** 키 | ✅ 공개 가능 (RLS가 지켜 줌) | `.env.local`(로컬), Netlify 환경변수 |
| Supabase **service_role / secret** 키 | ❌ 절대 비공개 | **어디에도 넣지 않는다.** 이 프로젝트는 쓸 일이 없음 |
| DB 비밀번호 | ❌ 비공개 | 선생님 비밀번호 관리자에만 |
| 나이스 API 인증키 | ❌ 비공개로 취급 | Supabase **Edge Function Secrets**에만 |
| 계정 비밀번호 | ❌ 비공개 | 선생님만 앎. 코드·파일·SQL 어디에도 없음 |

- `.gitignore`에 `.env`, `.env.*`(단 `.env.example` 제외)를 넣고, **첫 커밋 전에** 확인한다.
- `.env.example`에는 이름만: `VITE_SUPABASE_URL=` / `VITE_SUPABASE_ANON_KEY=`
- `VITE_`로 시작하는 변수는 화면 코드에 그대로 들어가므로 **공개 키만** `VITE_`를 붙인다.
- 커밋 전 점검: `git diff --cached`에 `service_role`, `sb_secret_`, 키처럼 긴 문자열이 없는지 🤖가 확인.

---

## 4. 데이터베이스 설계

### 테이블

**profiles** — 계정별 부가 정보 (실명·사진·연락처 칸 없음)
| 칼럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK, auth.users 참조) | 계정 |
| username | text, unique | 로그인 아이디 (`s01`) |
| nickname | text, null 가능, 최대 10자 | 별명 |
| role | text, `'admin'`/`'student'`, 기본 `'student'` | 권한 |
| created_at | timestamptz | |

**posts** — 게시판
| 칼럼 | 타입 | 설명 |
|---|---|---|
| id | bigint (PK) | |
| author_id | uuid, 기본값 `auth.uid()` | 글쓴이 |
| title | text, 1~50자 | |
| content | text, 1~2000자 | 글자만 (사진 업로드 없음) |
| created_at / updated_at | timestamptz | |

**lessons** — 오늘의 수업
| 칼럼 | 타입 | 설명 |
|---|---|---|
| id | bigint (PK) | |
| lesson_date | date | 수업 날짜 |
| period | smallint, null 가능 | 교시 (선택) |
| subject | text | 과목 |
| content | text | 수업 내용 |
| created_at | timestamptz | |

**homework** — 숙제
| 칼럼 | 타입 | 설명 |
|---|---|---|
| id | bigint (PK) | |
| title | text | |
| content | text | |
| due_date | date | 마감일 |
| created_at | timestamptz | |

급식은 **DB에 저장하지 않는다** (매번 나이스에서 받아 옴).

### 보안 규칙 (RLS) 요약

모든 테이블에 `enable row level security` 를 켠다. 정책이 없는 동작은 전부 거부된다.

| 테이블 | 읽기 (select) | 쓰기 (insert) | 수정 (update) | 삭제 (delete) |
|---|---|---|---|---|
| profiles | 로그인한 사람 | ✖ (트리거만) | 본인: `nickname`만* / 관리자: 전부 | ✖ |
| posts | 로그인한 사람 | 로그인한 사람, `author_id = auth.uid()`일 때만 | **본인 글만** (`author_id` 바꾸기 금지) | **본인 글** 또는 **관리자** |
| lessons | 로그인한 사람 | 관리자만 | 관리자만 | 관리자만 |
| homework | 로그인한 사람 | 관리자만 | 관리자만 | 관리자만 |

\* 학생이 `role`을 스스로 `admin`으로 바꾸지 못하도록 **칼럼 단위 권한**(`grant update (nickname) on profiles to authenticated`)으로 막는다.

핵심 정책 예시 (실제 SQL은 M2에서 `supabase/schema.sql`로 작성):
```sql
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- posts
create policy "posts_read"   on posts for select to authenticated using (true);
create policy "posts_insert" on posts for insert to authenticated with check (author_id = auth.uid());
create policy "posts_update" on posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "posts_delete" on posts for delete to authenticated
  using (author_id = auth.uid() or is_admin());

-- lessons / homework (같은 모양)
create policy "lessons_read"  on lessons for select to authenticated using (true);
create policy "lessons_write" on lessons for all    to authenticated
  using (is_admin()) with check (is_admin());
```
- `anon`(로그인 안 한 사용자)에게는 어떤 정책도 주지 않는다 → 아무것도 못 읽음.

---

## 5. 🧑‍🏫 Supabase 가입과 설정 (단계별)

### 5-1. 가입과 프로젝트 만들기
1. https://supabase.com → **Start your project** → GitHub 계정 등으로 가입
2. **New project**
   - Name: `class-5-2`
   - Database Password: **Generate** 눌러 만든 뒤 비밀번호 관리자에 저장 (코드에 안 씀)
   - Region: **Northeast Asia (Seoul)**
   - Plan: Free
3. 프로젝트가 만들어질 때까지 1~2분 대기

### 5-2. 공개 키 확인 (로컬에만 저장)
1. 왼쪽 **Project Settings → API Keys** (또는 Connect 버튼)
2. **Project URL**과 **anon(public) / publishable** 키를 복사
3. 프로젝트 폴더에 `.env.local` 파일을 **직접** 만들고 붙여넣기
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=복사한_공개키
   ```
4. ⚠️ 같은 화면의 **service_role / secret** 키는 복사하지 않는다. 채팅에도 붙여넣지 않는다.

### 5-3. 로그인 설정
1. **Authentication → Sign In / Providers → Email**
   - Email 로그인: **켜기**
   - **Confirm email: 끄기** (가짜 주소라 확인 메일을 받을 수 없음)
2. **Authentication → Sign In / Providers** 상단(또는 Settings)
   - **Allow new users to sign up: 끄기** ← 외부인 가입 차단 (가장 중요)

### 5-4. 테이블과 보안 규칙 만들기 (M2에서)
1. **SQL Editor → New query**
2. 🤖가 만든 `supabase/schema.sql` 내용을 붙여넣고 **Run**
3. **Table Editor**에서 profiles / posts / lessons / homework 가 보이고, 각 테이블에 **RLS enabled** 표시가 있는지 확인

### 5-5. 계정 만들기 (비밀번호는 여기서만 입력)
1. **Authentication → Users → Add user → Create new user**
2. 관리자:
   - Email: `redsionkim@class52.local`
   - Password: 직접 정한 비밀번호
   - **Auto Confirm User: 체크**
3. 학생: 같은 방법으로 `s01@class52.local`, `s02@class52.local` … (비밀번호는 학생별로)
   - 학생 비밀번호 목록은 종이 또는 선생님 PC의 비공개 파일로만 관리 (이 저장소에 두지 않음)
4. 관리자 지정: **SQL Editor**에서 한 번만 실행
   ```sql
   update profiles set role = 'admin' where username = 'redsionkim';
   ```
5. 확인: **Table Editor → profiles** 에서 redsionkim 은 `admin`, 나머지는 `student`

### 5-6. 비밀번호 재설정
- **Authentication → Users** → 해당 학생 줄의 `…` → **Reset password / Update password** (메일이 아닌 직접 변경 방식 사용)

### 5-7. 급식용 비밀키 넣기 (M6에서)
1. 나이스 교육정보 개방 포털(https://open.neis.go.kr) 가입 → **인증키 신청** (활용 용도: 학급 누리집 급식 안내)
2. Supabase **Edge Functions → Secrets** (또는 Project Settings → Edge Functions)
   - Name: `NEIS_API_KEY` / Value: 발급받은 키
3. **Edge Functions → Deploy a new function → Via Editor**로 🤖가 만든 `meal` 함수 코드를 붙여넣어 배포
   (또는 Supabase CLI를 `npx supabase`로 사용 — 그때 안내)

### 참고: 무료 플랜 주의점
- **7일 동안 아무 요청이 없으면 프로젝트가 일시 정지**된다. 방학 뒤에는 대시보드에서 **Restore** 버튼을 누르면 된다.
- 용량: DB 500MB — 글자 위주 학급 누리집에는 충분.

---

## 6. 기능별 화면 설계

### 공통
- 상단 메뉴: 홈 · 게시판 · 오늘의 수업 · 숙제 · 식단 · (내 아이디) · 로그아웃
- 로그인 안 되어 있으면 어떤 주소로 와도 로그인 화면으로 보냄
- 관리자일 때만 "작성/수정/삭제" 버튼 표시 (실제 차단은 RLS)
- 모든 사용자 입력은 `textContent`로 표시 → 글에 HTML/스크립트를 넣어도 실행되지 않음(XSS 방지)
- 휴대폰·태블릿에서도 보이게 반응형

### 홈
- 오늘 날짜의 수업, 마감이 가까운 숙제 3개, 오늘 급식 한눈에

### 게시판
- 목록(최신순, 20개씩) → 글 보기 → 글쓰기
- 글쓴이 표시: 별명 또는 아이디
- 내 글: 수정·삭제 버튼 / 관리자: 모든 글에 삭제 버튼
- 글쓰기 화면 안내문: "친구 이름, 전화번호, 주소, 사진은 쓰지 않아요"
- 전화번호 모양(010-…)이 들어가면 저장 전에 경고 (보조 장치)

### 오늘의 수업
- 날짜 선택(◀ 오늘 ▶ + 달력) → 그 날짜 수업 목록 (교시 순)
- 관리자: 추가/수정/삭제

### 숙제
- 마감일 순 목록, "D-3", "오늘 마감", "마감 지남"(회색) 표시
- 기본은 아직 안 지난 숙제, "지난 숙제 보기" 토글
- 관리자: 추가/수정/삭제

### 식단
- 날짜 선택 → 그날 중식 메뉴 (알레르기 번호는 작게 표시, 칼로리)
- 주말·방학 등 데이터 없으면 "급식 정보가 없어요"
- 흐름: 화면 → `supabase.functions.invoke('meal', { date })` → Edge Function이 로그인 여부 확인 → 나이스 `mealServiceDietInfo` 호출 (`ATPT_OFCDC_SC_CODE`, `SD_SCHUL_CODE`, `MLSV_YMD`) → 메뉴만 정리해서 돌려줌
- 교육청 코드·학교 코드는 비밀이 아니므로 코드에 적어도 됨 (🧑‍🏫 학교 이름만 알려주면 🤖가 `schoolInfo` API로 찾아 줌)

---

## 7. 개인정보 보호 설계

- **저장하지 않는 것**: 실명, 사진, 전화번호, 주소, 실제 이메일, 생년월일
- 계정은 번호 아이디(`s01`)와 가짜 이메일(`@class52.local`)뿐
- 사진·파일 업로드 기능 자체를 만들지 않음 (Supabase Storage 사용 안 함)
- 글 내용은 학생이 쓰므로 완벽히 막을 수 없음 → 안내문 + 전화번호 경고 + **관리자 삭제 권한**으로 대응
- 로그인한 우리 반만 조회 가능 (RLS + 가입 차단)
- 학년이 끝나면: Supabase에서 학생 계정 삭제 → 게시글도 함께 삭제되도록 `on delete cascade`

---

## 8. 개발 순서 (마일스톤)

각 단계는 **로컬(`npm run dev`)에서 직접 눈으로 확인**한 뒤 다음으로 넘어간다. 커밋은 단계마다 하고, `git push`(=Netlify 배포)는 "올려줘" 할 때만.

### M0. 준비 🧑‍🏫
- 5-1 ~ 5-3 진행 (가입, 프로젝트, 공개 키를 `.env.local`에, 가입 차단)
- ✅ 확인: `.env.local` 파일이 있고, Supabase에서 "Allow new users to sign up"이 꺼져 있음

### M1. 화면 뼈대 🤖
- Vite 프로젝트 생성, `.gitignore`/`.env.example`, 메뉴와 빈 페이지 5개, 해시 라우팅
- ✅ 확인: `npm run dev` → 메뉴를 눌러 페이지가 바뀜 / `git status`에 `.env.local`이 **안** 보임

### M2. DB와 보안 규칙 🤖 → 🧑‍🏫
- 🤖 `supabase/schema.sql` 작성 → 🧑‍🏫 SQL Editor에서 실행 (5-4)
- 🧑‍🏫 관리자 1개 + 테스트 학생 2개(`s01`, `s02`) 만들기, 관리자 지정 (5-5)
- ✅ 확인: Table Editor에 테이블 4개, 모두 RLS enabled / profiles에 역할이 맞게 들어가 있음

### M3. 로그인 🤖
- 로그인 화면(아이디+비밀번호), 로그아웃, 로그인 안 하면 로그인 화면으로
- ✅ 확인
  - `s01`로 로그인 → 메뉴에 `s01` 표시, 새로고침해도 유지
  - 틀린 비밀번호 → "아이디 또는 비밀번호가 달라요"
  - 로그아웃 후 `#/board` 직접 입력 → 로그인 화면으로 이동

### M4. 게시판 🤖
- 목록·보기·쓰기·수정·삭제
- ✅ 확인 (RLS 실험 포함)
  - `s01`로 글쓰기 → `s02`로 로그인 시 글은 보이지만 수정/삭제 버튼 없음
  - `s02` 상태에서 브라우저 개발자도구 콘솔로 `s01` 글 삭제 시도 → **0건 삭제**(DB가 막음) — 🤖가 복사용 명령 제공
  - `redsionkim`으로 로그인 → `s01` 글 삭제 성공
  - 제목에 `<script>alert(1)</script>` → 글자로만 보임

### M5. 오늘의 수업 · 숙제 🤖
- 관리자 작성 화면, 날짜별 보기, 마감일 표시
- ✅ 확인
  - 관리자로 오늘·내일 수업 입력 → 날짜 넘기며 보기
  - 학생으로 로그인 시 작성 버튼 없음 / 콘솔로 insert 시도 → **권한 오류**
  - 숙제 마감일이 D-표시로 보이고, 지난 숙제는 회색

### M6. 식단 🤖 → 🧑‍🏫
- 🧑‍🏫 나이스 인증키 발급, 학교 이름 알려주기, Secret 등록 (5-7)
- 🤖 Edge Function `meal` 작성 → 🧑‍🏫 배포 → 🤖 식단 화면 연결
- ✅ 확인: 오늘/다른 날짜 급식이 나이스 홈페이지 내용과 같음 / 주말은 "정보 없음" / 로그아웃 상태에서 함수 직접 호출 시 401

### M7. 홈 요약 · 다듬기 🤖
- 홈 화면 요약, 휴대폰 크기 확인, 빈 목록·오류 문구
- ✅ 확인: 개발자도구 휴대폰 모드에서 모든 메뉴 사용 가능

### M8. 배포 🧑‍🏫 + 🤖
1. 🧑‍🏫 GitHub에 **비공개(Private)** 저장소 `class-5-2` 만들기 → 🤖가 remote 연결
2. 🤖 push 전에 `npm run build` + `npm run preview`로 최종 로컬 확인, 비밀키 검사
3. 🧑‍🏫 "올려줘" → 🤖 `git push`
4. 🧑‍🏫 Netlify: **Add new site → Import from GitHub** → 저장소 선택
   - Build command: `npm run build` / Publish directory: `dist`
   - **Environment variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 입력 (공개 키 2개만)
5. ✅ 확인: Netlify 주소에서 M3~M6 확인 항목을 한 번 더
6. 🧑‍🏫 나머지 학생 계정 생성 (5-5)

> 배포 크레딧 절약: 여러 수정은 로컬에서 모아서 확인하고, 한 번에 "올려줘".

---

## 9. 나중에 고려할 것 (이번 범위 아님)
- 게시글 댓글, 공지 상단 고정
- 학생 본인 비밀번호 변경 화면
- 급식 결과 캐시(같은 날짜 반복 호출 줄이기)
- 시간표 표시 (나이스 `elsTimetable` API)
