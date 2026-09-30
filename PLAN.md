# 5학년 2반 학급 누리집 설계 (PLAN)

> 이 문서는 **설계만** 담는다. 코드는 아직 없다.
> 표시: 🧑‍🏫 = 선생님이 직접 할 일, 🤖 = Claude가 코드로 할 일

---

## 1. 전체 구조

```
[브라우저]  ── Vite로 만든 정적 화면 (Netlify에 배포)
    │
    └─ 로그인 · 게시판 · 수업 · 숙제 · 식단 ──▶ [Supabase]
                                              ├ Auth (로그인)
                                              └ Postgres DB + RLS (보안 규칙)
```

| 구성 | 선택 | 이유 |
|---|---|---|
| 화면 | Vite + 순수 JavaScript (프레임워크 없음) | 가볍고, 코드를 읽고 고치기 쉬움 |
| 페이지 이동 | 해시 라우팅 (`#/board`, `#/lessons` …) | Netlify에서 새로고침해도 404가 안 남, 별도 설정 불필요 |
| 로그인 · DB | Supabase 무료 플랜 | Auth + Postgres + RLS를 한 곳에서 |
| 급식 | 관리자가 날짜별로 직접 입력 (`meals` 테이블) | 외부 API·인증키 없이 단순하게, 수업·숙제와 같은 방식 |
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
│  └─ make-admin.sql     # 관리자 지정
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
| 계정 비밀번호 | ❌ 비공개 | 선생님만 앎. 코드·파일·SQL 어디에도 없음 |

- `.gitignore`에 `.env`, `.env.*`(단 `.env.example` 제외)를 넣고, **첫 커밋 전에** 확인한다.
- `.env.example`에는 이름만: `VITE_SUPABASE_URL=` / `VITE_SUPABASE_PUBLISHABLE_KEY=`
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

**meals** — 급식 (관리자가 직접 입력, 하루에 하나)
| 칼럼 | 타입 | 설명 |
|---|---|---|
| id | bigint (PK) | |
| meal_date | date, unique | 급식 날짜 |
| menu | text, 1~1000자 | 한 줄에 한 가지 음식 |
| created_at | timestamptz | |

### 보안 규칙 (RLS) 요약

모든 테이블에 `enable row level security` 를 켠다. 정책이 없는 동작은 전부 거부된다.

| 테이블 | 읽기 (select) | 쓰기 (insert) | 수정 (update) | 삭제 (delete) |
|---|---|---|---|---|
| profiles | 로그인한 사람 | ✖ (트리거만) | 본인: `nickname`만* (역할 변경은 SQL Editor에서만) | ✖ |
| posts | 로그인한 사람 | 로그인한 사람, `author_id = auth.uid()`일 때만 | **본인 글만** (`author_id` 바꾸기 금지) | **본인 글** 또는 **관리자** |
| lessons | 로그인한 사람 | 관리자만 | 관리자만 | 관리자만 |
| homework | 로그인한 사람 | 관리자만 | 관리자만 | 관리자만 |
| meals | 로그인한 사람 | 관리자만 | 관리자만 | 관리자만 |

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
   VITE_SUPABASE_PUBLISHABLE_KEY=복사한_공개키
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
> ⚠️ **반드시 5-4(schema.sql 실행) 다음에** 만든다. 계정이 생길 때 `profiles`에 자동으로 한 줄을 만드는 트리거가 schema.sql 안에 있기 때문이다.

1. **Authentication → Users → Add user → Create new user**
2. 관리자:
   - Email: `redsionkim@class52.local`
   - Password: 직접 정한 비밀번호
   - **Auto Confirm User: 체크**
3. 학생: 같은 방법으로 `s01@class52.local`, `s02@class52.local` … (비밀번호는 학생별로)
   - 학생 비밀번호 목록은 종이 또는 선생님 PC의 비공개 파일로만 관리 (이 저장소에 두지 않음)
4. 관리자 지정: **SQL Editor**에서 `supabase/make-admin.sql` 내용을 붙여넣고 Run (한 번만)
5. 확인: 실행 결과 표(또는 **Table Editor → profiles**)에서 redsionkim 은 `admin`, 나머지는 `student`

### 5-6. 비밀번호 재설정
- **Authentication → Users** → 해당 학생 줄의 `…` → **Reset password / Update password** (메일이 아닌 직접 변경 방식 사용)

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
- 날짜 선택(◀ 오늘 ▶ + 달력) → 그날 메뉴 (한 줄에 한 가지)
- 등록 안 된 날은 "이 날은 등록된 급식이 없어요"
- 관리자: 그날 메뉴 입력·수정·삭제 (하루에 하나, 저장하면 덮어씀)

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

### M6. 식단 🤖
- 관리자가 날짜별로 메뉴를 직접 입력하는 화면 (처음엔 나이스 자동 연동으로 만들었다가 직접 입력으로 바꿈)
- ✅ 확인: 관리자로 오늘 메뉴 입력 → 홈과 식단에 보임 / 학생에게는 입력 칸이 없음

### M7. 홈 요약 · 다듬기 🤖
- 홈 화면 요약, 휴대폰 크기 확인, 빈 목록·오류 문구
- ✅ 확인: 개발자도구 휴대폰 모드에서 모든 메뉴 사용 가능

### M8. 배포 🧑‍🏫 + 🤖
1. 🧑‍🏫 GitHub에 **비공개(Private)** 저장소 `class-5-2` 만들기 → 🤖가 remote 연결
2. 🤖 push 전에 `npm run build` + `npm run preview`로 최종 로컬 확인, 비밀키 검사
3. 🧑‍🏫 "올려줘" → 🤖 `git push`
4. 🧑‍🏫 Netlify: **Add new site → Import from GitHub** → 저장소 선택
   - Build command: `npm run build` / Publish directory: `dist`
   - **Environment variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 입력 (공개 키 2개만)
5. ✅ 확인: Netlify 주소에서 M3~M6 확인 항목을 한 번 더
6. 🧑‍🏫 나머지 학생 계정 생성 (5-5)

> 배포 크레딧 절약: 여러 수정은 로컬에서 모아서 확인하고, 한 번에 "올려줘".

---

## 9. 나중에 고려할 것 (이번 범위 아님)
- 게시글 댓글, 공지 상단 고정
- 학생 본인 비밀번호 변경 화면
- 시간표 표시 (나이스 `elsTimetable` API)

---

## 10. 만들면서 정한 것 (M2~M8)

사용자에게 묻지 않고 이 문서의 원칙대로 정한 것들. 바꾸고 싶으면 말만 하면 된다.

**로그인·계정**
1. 아이디는 영어 소문자·숫자·`_` 2~30자. 대문자나 앞뒤 공백을 넣어도 소문자로 바꿔서 로그인한다 (`S01 ` → `s01`).
2. 역할(role) 변경은 앱 화면이 아니라 **SQL Editor에서만** 한다 (`supabase/make-admin.sql`). 앱에 "관리자 지정" 버튼은 없다.
3. 학생이 별명을 정할 수 있는 **내 정보(`#/me`)** 화면을 추가했다. 머리글의 내 아이디를 누르면 간다.
4. 로그인 화면에 "비밀번호를 잊었으면 선생님께" 안내만 두고, 비밀번호 찾기·변경 기능은 만들지 않았다.

**DB·보안**
5. RLS 위에 **칼럼 권한**을 한 겹 더 뒀다: 게시글은 제목·내용만 쓰고 고칠 수 있어서 글쓴이·작성 시각을 조작할 수 없다. profiles는 별명만 고칠 수 있다.
6. 글자 수 제한 (DB에서도 검사): 게시글 제목 50자·내용 2000자, 별명 10자, 수업 과목 20자·내용 2000자, 숙제 이름 50자·설명 1000자, 교시 1~8.
7. 학생 계정을 지우면 그 학생의 글도 함께 지워진다.
8. `schema.sql`은 여러 번 실행해도 안전하게 만들었고, 계정을 먼저 만들었어도 profiles를 채워 넣는다.
9. SQL 보안 규칙을 컴퓨터 안의 작은 Postgres(PGlite)로 실험하는 `npm run test:rls`를 만들었다 (25개 항목).

**게시판**
10. 한 쪽에 20개씩, 최신 글이 위. 고친 글에는 "(고침)"을 표시한다.
11. 관리자도 게시판에 글을 쓸 수 있다. 관리자는 남의 글을 **삭제만** 할 수 있고 고칠 수는 없다.
12. 전화번호처럼 보이는 숫자가 있으면 **막지는 않고 확인창으로 경고**한다 (최종 대응은 관리자 삭제).

**수업·숙제**
13. 수업은 교시 순서, 교시 없는 수업은 맨 뒤. 날짜는 ◀ ▶ 버튼·달력·"오늘" 버튼으로 이동한다.
14. 숙제 기본 화면은 오늘 마감 이후 숙제만 마감이 빠른 순서로 보여 준다. "지난 숙제 보기"는 최근 50개.
15. 마감 표시 색: 오늘 마감 = 빨강, D-1·D-2 = 노랑, D-3 이상 = 초록, 마감 지남 = 흐리게.
16. "오늘"은 보는 사람 기기의 날짜 기준이다.

**식단**
17. 급식은 관리자가 날짜별로 직접 입력한다. 하루에 하나만 저장되고, 같은 날 다시 저장하면 고쳐진다.
18. 메뉴는 한 줄에 한 가지. 빈 줄과 앞뒤 공백은 저장할 때 지운다.
19. 홈에는 오늘 메뉴를, 식단 화면에는 고른 날짜의 메뉴를 보여 준다.
20. 나이스 연동과 Edge Function은 쓰지 않는다 (인증키·함수 배포가 필요 없음).

**배포·기타**
21. `netlify.toml`: Node 24, 빌드 `npm run build` → `dist`. 공개용 변수 2개는 Netlify 비밀값 검사에서 제외해서 배포가 괜히 멈추지 않게 했다 (배포 크레딧 절약).
22. 검색 엔진에 나오지 않도록 `noindex`를 설정했다. 다른 사이트 안에 끼워 넣는 것(iframe)도 막았다.
23. `npm run check:secrets`: GitHub에 올라갈 파일과 `dist`에서 `sb_secret_` 키나 service_role 키를 찾는다. push 전에 🤖가 실행한다.

---

## 11. 🧑‍🏫 선생님 체크리스트 (순서대로)

> 비밀번호와 키는 **Supabase·Netlify 화면에만** 입력합니다. 파일이나 채팅에는 쓰지 않습니다.

### A. Supabase 데이터베이스
- [ ] **1. 테이블과 보안 규칙 만들기**: SQL Editor → New query → `supabase/schema.sql` 전체 붙여넣기 → Run → "Success" 확인
- [ ] **2. 확인**: Table Editor에 `profiles`, `posts`, `lessons`, `homework` 4개가 있고 모두 **RLS enabled**
- [ ] **3. 계정 3개 만들기**: Authentication → Users → Add user → Create new user, **Auto Confirm User 체크**
  - `redsionkim@class52.local` (관리자)
  - `s01@class52.local`, `s02@class52.local` (테스트 학생)
- [ ] **4. 관리자 지정**: SQL Editor에서 `supabase/make-admin.sql` Run → 결과 표에서 redsionkim, teacher0502만 `admin`

### B. 내 컴퓨터에서 확인 (`npm run dev` → http://localhost:5173)
- [ ] **5. 로그인**: 로그인 안 한 상태로 `#/board`를 직접 입력하면 로그인 화면으로 간다 / 틀린 비밀번호는 "아이디 또는 비밀번호가 달라요" / `s01` 로그인 후 새로고침해도 유지
- [ ] **6. 게시판**: `s01`로 글쓰기 (제목에 `<b>굵게</b>`를 넣어 보면 글자 그대로 보임) → 주소창의 글 번호(`#/board/1`의 `1`)를 적어 두기
- [ ] **7. 🔒 보안 실험 (학생이 남의 글 지우기 시도)**: 로그아웃하고 `s02`로 로그인 → 그 글에 수정·삭제 버튼이 없는지 확인 → **F12 → Console** 탭에서 아래를 한 줄씩 붙여넣기
  (붙여넣기가 막히면 `allow pasting`이라고 입력하고 Enter. `1`은 6번에서 적은 글 번호로 바꾸기)
  ```js
  const { supabase } = await import('/src/supabase.js');

  // 실험 1: 남의 글 삭제 → 기대 결과 data: [] (0건, 아무것도 안 지워짐)
  await supabase.from('posts').delete().eq('id', 1).select();

  // 실험 2: 남의 글 수정 → 기대 결과 data: []
  await supabase.from('posts').update({ title: '해킹' }).eq('id', 1).select();

  // 실험 3: 스스로 관리자 되기 → 기대 결과 error (permission denied)
  await supabase.from('profiles').update({ role: 'admin' }).eq('username', 's02').select();

  // 실험 4: 학생이 수업 쓰기 → 기대 결과 error (row-level security)
  await supabase.from('lessons').insert({ lesson_date: '2026-10-01', subject: '실험', content: '학생이 쓰기' }).select();
  ```
  → 새로고침해서 글이 그대로 있으면 **성공**
- [ ] **8. 로그아웃 상태 실험**: 로그아웃 → Console에서 `const { supabase } = await import('/src/supabase.js');` 다음 `await supabase.from('posts').select();` → 기대 결과 **error (permission denied)**
- [ ] **9. 관리자**: `redsionkim`으로 로그인 → `s01` 글에 삭제 버튼만 있고, 누르면 지워짐 / 오늘의 수업·숙제에 입력 칸이 보이고 추가·수정·삭제가 됨 / 숙제에 D-표시

### C. 급식
- [ ] **10. 급식 테이블 추가**: SQL Editor에서 `supabase/schema.sql` 전체를 **다시** Run (여러 번 실행해도 안전, 기존 글은 그대로) → Table Editor에 `meals`가 생기고 RLS enabled
- [ ] **11. 확인**: 관리자로 **식단** 메뉴에서 오늘 메뉴 입력 → 홈에도 보임 / 학생 계정에는 입력 칸이 없음

### D. 배포
- [ ] **12. GitHub 저장소**: https://github.com/new 에서 **Private**, 이름 `class-5-2`, README 등 체크 없이 만들기 → 저장소 주소를 🤖에게 알려 주기 (🤖가 remote 연결)
- [ ] **13. "올려줘"** → 🤖가 비밀키 검사·빌드 후 `git push`
- [ ] **14. Netlify 연결**: Add new project → Import an existing project → GitHub → `class-5-2`
  - 빌드 설정은 `netlify.toml`에서 자동으로 채워짐 (`npm run build` / `dist`)
  - **Deploy 누르기 전에** Environment variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 두 개 입력 (값은 `.env.local`과 같게, 공개 키만)
  - Deploy
- [ ] **15. 배포 주소에서 확인**: 5번(로그인), 6번(글쓰기), 11번(식단)을 Netlify 주소에서 한 번 더
  - 7번 콘솔 실험은 **내 컴퓨터(`npm run dev`)에서만** 됩니다. 배포 주소에서는 안 해도 됩니다.
- [ ] **16. 나머지 학생 계정**: `s03@class52.local` … 3번과 같은 방법 (Auto Confirm 체크). 테스트로 쓴 글은 관리자로 지우기

### 알아 둘 것
- 방학 등으로 7일 넘게 아무도 접속하지 않으면 Supabase가 멈춥니다 → 대시보드에서 **Restore**
- 학생 비밀번호 변경: Authentication → Users → 학생 줄 `…` → 비밀번호 변경
