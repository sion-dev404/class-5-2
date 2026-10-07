# 5학년 2반 학급 누리집 설계 (PLAN)

> 이 문서는 **설계만** 담는다. 코드는 아직 없다.
> 표시: 🧑‍🏫 = 선생님이 직접 할 일, 🤖 = Claude가 코드로 할 일

---

## 1. 전체 구조

```
[브라우저]  ── Vite로 만든 정적 화면 (GitHub Pages에 배포)
    │
    └─ 로그인 · 게시판 · 수업 · 숙제 · 식단 ──▶ [Supabase]
                                              ├ Auth (로그인)
                                              └ Postgres DB + RLS (보안 규칙)
```

| 구성 | 선택 | 이유 |
|---|---|---|
| 화면 | Vite + 순수 JavaScript (프레임워크 없음) | 가볍고, 코드를 읽고 고치기 쉬움 |
| 페이지 이동 | 해시 라우팅 (`#/board`, `#/lessons` …) | GitHub Pages에서 새로고침해도 404가 안 남, 별도 설정 불필요 |
| 로그인 · DB | Supabase 무료 플랜 | Auth + Postgres + RLS를 한 곳에서 |
| 급식 | 관리자가 날짜별로 직접 입력 (`meals` 테이블) | 외부 API·인증키 없이 단순하게, 수업·숙제와 같은 방식 |
| 배포 | GitHub Pages (GitHub Actions 자동 빌드) | `git push` 때만 배포 → "올려줘" 할 때만 push. 크레딧 없음 (처음엔 Netlify였다가 옮김) |

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
| Supabase Project URL | ✅ 공개 가능 | `.env.local`(로컬), GitHub 저장소 Actions **Variables** (코드에는 안 둠) |
| Supabase **anon / publishable** 키 | ✅ 공개 가능 (RLS가 지켜 줌) | `.env.local`(로컬), GitHub 저장소 Actions **Variables** (코드에는 안 둠) |
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

- **저장하지 않는 것**: 전화번호, 주소, 실제 이메일, 생년월일 (계정 정보에는 사진도 없음)
- **실명(사용자 요청으로 추가, 관리용)**: `student_names` 표에 따로 저장. **관리자만** 읽고 쓸 수 있고 학생은 자기 실명도 못 읽음 (RLS)
  - 관리자 화면 "학생 관리"(`#/admin`)에서 입력, 게시판 글쓴이 옆에 관리자에게만 `· 실명`으로 보임
  - 학생 화면에는 지금처럼 별명/아이디만 보임
- 계정은 번호 아이디(`s01`)와 가짜 이메일(`@class52.local`)뿐
- 게시판 첨부 파일(사용자 요청으로 추가): 비공개 보관함이라 **로그인한 우리 반만** 볼 수 있음
  - 사진은 올릴 때 다시 그려서 **촬영 위치(GPS)·기기 정보를 지우고** 긴 쪽 1600px로 줄임
  - 글쓰기 화면 안내: "친구 얼굴이 나온 사진은 친구에게 먼저 물어보고 올려요"
  - 관리자는 어떤 글이든 첨부와 함께 삭제 가능
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

**첨부 파일**
24. 글 하나에 5개, 파일 하나 50MB까지 (Supabase 무료 플랜 최대치. 1GB는 유료 Pro 플랜에서만 가능). 사진(jpg·png·gif·webp), pdf, 한글(hwp·hwpx), 워드·엑셀·파워포인트, txt만 허용 (exe·zip·svg 등은 거절).
25. 로그인한 사람은 누구나 다른 친구 글의 첨부도 보고 내려받을 수 있다. 로그인 안 한 사람은 못 받는다.
26. 사진은 글 안에 바로 보이고(누르면 크게), 모든 파일에 "내려받기" 버튼이 있다. 한글 파일 이름 그대로 저장된다.
27. 보관 위치는 `올린사람ID/글번호/무작위이름` — 남의 글 폴더에는 올릴 수 없다 (저장소 보안 규칙).
28. 글을 지우면 첨부 파일도 보관함에서 지운다. 수정 화면에서 파일을 빼거나 더할 수 있다.
29. 저장 공간: Supabase 무료 1GB (사진을 줄여 올리므로 수천 장 가능).

**실명 (관리용)**
30. 실명은 선생님(관리자)만 본다. 반 전체가 보게 하려면 `student_names` 읽기 규칙만 바꾸면 된다.
31. 학생 관리 화면에는 학생 계정만 나온다 (관리자 계정 제외). 칸을 비우고 저장하면 그 학생 실명이 지워진다.
32. 실명은 20자까지. 학생 계정을 지우면 실명도 함께 지워진다.

**댓글**
33. 로그인한 사람은 누구 글에나 댓글을 쓸 수 있다 (500자, 글자만).
34. 댓글은 고칠 수 없고, 지우기만 된다: 내 댓글은 내가, 모든 댓글은 관리자가. 글쓴이라도 남의 댓글은 못 지운다.
35. 게시판 목록에 댓글 수를 `[3]`처럼 표시한다. 글을 지우면 댓글도 함께 지워진다.

**보드 (주제별 글)**
36. 선생님이 주제를 만들고, 학생은 열린 주제에 글을 쓴다. 보드 글은 게시판 글과 같은 기능(첨부·댓글·삭제)을 쓰되 게시판 목록에는 섞이지 않는다.
37. 주제는 지우지 않고 **마감/다시 열기**만 한다 → 지난 주제와 글이 계속 남는다 (글이 있는 주제는 DB에서도 삭제 불가).
38. 마감된 주제에는 학생이 글을 쓸 수 없다 (DB 규칙). 선생님은 쓸 수 있다.

**퀴즈**
39. 선생님이 객관식(보기 2~5개)·주관식 문제로 퀴즈를 만든다 (20문제까지). 주관식 정답은 `서울|서울특별시`처럼 여러 개 가능, 띄어쓰기·대소문자 무시.
40. 정답은 `quiz_keys` 표에 따로 두어 학생은 읽을 수 없다. 채점은 서버 함수 `submit_quiz`가 하고, 학생은 점수를 직접 기록할 수 없다.
41. 한 사람 한 번만 제출. 제출하면 바로 내 점수와 틀린 문제의 정답이 보인다. 선생님은 "다시 풀게 하기"로 답안을 지울 수 있다.
42. 퀴즈는 닫기/다시 열기/삭제 가능. 만든 뒤 문제 고치기는 없음 (삭제 후 다시 만들기).
42-1. **제한 시간**: 만들 때 없음/30초/1·2·3·5·10·15·20·30분 중 선택. 학생이 "시작하기"를 누른 **서버 시각**부터 잰다 (기기 시계와 무관).
42-2. 문제는 "시작"한 학생과 선생님만 읽을 수 있다 (DB 규칙) → 미리 보고 시간 벌기 방지. 시작 후 나갔다 들어와도 남은 시간은 이어진다.
42-3. 시간이 다 되면 자동 제출. 서버는 제한 시간 + 30초가 지난 제출은 거절한다 (그때는 선생님이 "다시 풀게 하기").
42-4. **⚡ 빨리 푼 순위**: 만점자만 걸린 시간 순으로 모두에게 보인다 (점수는 공개하지 않기 위해 만점자만). 선생님 결과표는 점수 높은 순 → 빠른 순, 걸린 시간 표시.

**실시간 퀴즈 (🚀 레이스)**
42-5. 퀴즈를 만들 때 종류를 고른다: **혼자 풀기**(지금까지의 퀴즈, 시간 날 때 각자) / **실시간**(선생님이 시작하면 다 함께).
42-6. 실시간: 선생님이 "▶ 시작!"을 누른 **서버 시각**부터 제한 시간을 잰다. 그전에는 학생에게 문제가 보이지 않는다 (DB 규칙). 학생 화면은 대기 → 시작되면 자동으로 문제가 나온다.
42-7. 학생은 **한 문제씩** 풀고, 답하면 바로 ⭕/❌만 보여 준다 (정답은 안 알려 줌). 한 문제에 한 번만 답할 수 있다. 다 풀면 "결승선 도착".
42-8. **레이스 화면**(선생님, 새 창, 프로젝터용): 우주 배경, 학생마다 🚀 우주선(별명/아이디, 실명은 안 띄움). 답할 때마다 한 칸 이동, 다 풀면 결승선에서 반짝. 옆 순위표 1~24등.
42-9. 순위 = **맞힌 수 → 답한 수 → 먼저 끝낸 순**. "맞힌 수 보이기"는 기본 꺼짐 (켜면 ✔개수 표시). 24명이 한 화면(1366×768 이상)에 다 들어간다.
42-10. 바뀌면 바로 보이도록 Supabase Realtime을 쓰고, 혹시 안 되면 2초마다 다시 확인한다. 선생님은 끝내기 / 처음부터 다시(답 모두 지움)를 할 수 있다.

**참가 현황 (보드·퀴즈 공통)**
43. 명단은 학생 계정 전체 (role = student, 우리 반 24명). 계정을 만들거나 지우면 자동 반영. "참여 n / 23"과 진행 막대, 학생별 ✅/⬜ 표시.
44. 퀴즈 점수는 선생님과 본인만 본다. 다른 학생에게는 누가 냈는지만 보인다. 선생님에게는 실명과 점수, 평균도 보인다.

**공감**
45. 게시판·보드 글마다 ♥ 공감 버튼. 한 사람 한 번, 다시 누르면 취소. 공감 수와 공감한 친구(별명/아이디)가 보인다. 목록에 `♥3` 표시.

**1인1역**
46. 선생님이 역할을 만들고 학생마다 하나씩 정한다. 학생은 **오늘만** "오늘 했어요"를 체크·취소할 수 있다 (한국 시간 기준, DB 규칙). 선생님은 아무 날짜나 대신 체크할 수 있다.
47. 날짜를 넘겨 지난 현황도 볼 수 있다. 참가 현황 칩에 역할 이름이 함께 보인다.

**캘린더 (홈)**
48. 홈 아래쪽에 월 달력. 파란 점 = 학급 일정(선생님이 추가·삭제), 주황 점 = 숙제 마감일. 날짜를 누르면 그날 목록.

**갤러리**
49. 게시판·보드 글에 첨부된 사진을 최신 순으로 모아 보여 준다 (24장씩, "더 보기"). 사진을 누르면 그 글로 간다. 따로 올리는 곳은 없다.

**점수 랭킹**
50. 선생님이 학생을 골라 칭찬·활동 점수(-100~100, 0 제외)와 이유를 준다. 여러 명에게 한 번에 줄 수 있고, 기록은 취소 가능.
51. 순위표(같은 점수는 같은 등수, 1~3등 메달)와 퀴즈 맞힌 수 합계는 선생님 화면.
52. **학생도 "순위" 메뉴에서 등수와 이름은 본다. 점수 숫자는 볼 수 없다** — 점수 표는 학생에게 잠겨 있고, 서버 함수 `points_ranking`이 등수만 계산해 준다. 내 줄은 "나"로 표시.

**자리 뽑기 (관리자만)**
53. "설정"과 "뽑기" 화면이 따로 있다. 설정: 모둠 크기(기본 4명, 이 컴퓨터에 기억), **같은 모둠 금지** 묶음(2명 이상, 묶음 안 학생끼리는 서로 다른 모둠).
54. 뽑기는 랜덤이 기본이고 금지 조건을 지킨다 (최대 3000번 시도, 못 찾으면 안내). 모둠 인원은 고르게 나눈다 (24명·4명 → 4명×6모둠, 23명 → 4명×5 + 3명×1).
55. 뽑은 뒤 선생님이 두 학생을 차례로 눌러 자리를 맞바꿀 수 있다 (직접 설정). 금지 조건을 어긴 모둠은 빨갛게 표시.
56. "이 자리로 저장"하면 기록이 남고(최근 10개), 지난 기록을 불러올 수 있다. 학생은 자리 메뉴·기록을 볼 수 없다.

**배포·기타**
21. (옛 Netlify 설정 — 지금은 GitHub Pages로 옮김, 12장 참고)
22. 검색 엔진에 나오지 않도록 `noindex`를 설정했다. 다른 사이트 안에 끼워 넣는 것(iframe)도 막았다.
23. `npm run check:secrets`: GitHub에 올라갈 파일과 `dist`에서 `sb_secret_` 키나 service_role 키를 찾는다. push 전에 🤖가 실행한다.

---

## 11. 🧑‍🏫 선생님 체크리스트 (순서대로)

> 비밀번호와 키는 **Supabase·GitHub 설정 화면에만** 입력합니다. 파일이나 채팅에는 쓰지 않습니다.

### A. Supabase 데이터베이스
- [ ] **1. 테이블과 보안 규칙 만들기**: SQL Editor → New query → `supabase/schema.sql` 전체 붙여넣기 → Run → "Success" 확인
- [ ] **2. 확인**: Table Editor에 `profiles`, `posts`, `lessons`, `homework` 4개가 있고 모두 **RLS enabled**
- [ ] **3. 계정 3개 만들기**: Authentication → Users → Add user → Create new user, **Auto Confirm User 체크**
  - `redsionkim@class52.local` (관리자)
  - `s01@class52.local`, `s02@class52.local` (테스트 학생)
- [ ] **4. 관리자 지정**: SQL Editor에서 `supabase/make-admin.sql` Run → 결과 표에서 redsionkim, teacher0502만 `admin`

### B. 내 컴퓨터에서 확인 (`npm run dev` → http://localhost:5173/class-5-2/)
- [ ] **5. 로그인**: 로그인 안 한 상태로 `#/board`를 직접 입력하면 로그인 화면으로 간다 / 틀린 비밀번호는 "아이디 또는 비밀번호가 달라요" / `s01` 로그인 후 새로고침해도 유지
- [ ] **6. 게시판**: `s01`로 글쓰기 (제목에 `<b>굵게</b>`를 넣어 보면 글자 그대로 보임) → 주소창의 글 번호(`#/board/1`의 `1`)를 적어 두기
- [ ] **7. 🔒 보안 실험 (학생이 남의 글 지우기 시도)**: 로그아웃하고 `s02`로 로그인 → 그 글에 수정·삭제 버튼이 없는지 확인 → **F12 → Console** 탭에서 아래를 한 줄씩 붙여넣기
  (붙여넣기가 막히면 `allow pasting`이라고 입력하고 Enter. `1`은 6번에서 적은 글 번호로 바꾸기)
  ```js
  const { supabase } = await import('/class-5-2/src/supabase.js');

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
- [ ] **8. 로그아웃 상태 실험**: 로그아웃 → Console에서 `const { supabase } = await import('/class-5-2/src/supabase.js');` 다음 `await supabase.from('posts').select();` → 기대 결과 **error (permission denied)**
- [ ] **9. 관리자**: `redsionkim`으로 로그인 → `s01` 글에 삭제 버튼만 있고, 누르면 지워짐 / 오늘의 수업·숙제에 입력 칸이 보이고 추가·수정·삭제가 됨 / 숙제에 D-표시

### C. 급식
- [ ] **10. 급식 테이블 추가**: SQL Editor에서 `supabase/schema.sql` 전체를 **다시** Run (여러 번 실행해도 안전, 기존 글은 그대로) → Table Editor에 `meals`가 생기고 RLS enabled
- [ ] **11. 확인**: 관리자로 **식단** 메뉴에서 오늘 메뉴 입력 → 홈에도 보임 / 학생 계정에는 입력 칸이 없음

- [ ] **11-6. 순위·자리 뽑기·퀴즈 시간 추가**: 같은 `schema.sql` 다시 Run → `seat_rules`, `seat_draws`, `quiz_starts`, `live_answers`, 함수 `points_ranking`·`start_quiz`·`quiz_speed_ranking`·`live_control`·`live_state`·`answer_live`
- [ ] **11-5. 공감·1인1역·캘린더·점수 추가**: 같은 `schema.sql` 다시 Run → `post_likes`, `jobs`, `job_assignments`, `job_checks`, `events`, `points`
- [ ] **11-4. 보드·퀴즈 추가**: 같은 `schema.sql` 다시 Run → Table Editor에 `topics`, `quizzes`, `quiz_questions`, `quiz_keys`, `quiz_attempts`
- [ ] **11-3. 댓글 표 추가**: 같은 `schema.sql` 다시 Run → Table Editor에 `comments`
- [ ] **11-2. 실명 표 추가**: 같은 `schema.sql` 다시 Run에 포함됨 → Table Editor에 `student_names` → 관리자로 **학생 관리** 메뉴에서 실명 입력
- [ ] **11-1. 첨부 파일 보관함 추가**: SQL Editor에서 `supabase/schema.sql` 전체를 **다시** Run → Table Editor에 `post_files`, Storage에 비공개 `attachments` 보관함이 생김

### D. 배포
- [ ] **12. GitHub 저장소**: https://github.com/new 에서 **Private**, 이름 `class-5-2`, README 등 체크 없이 만들기 → 저장소 주소를 🤖에게 알려 주기 (🤖가 remote 연결)
- [ ] **13. "올려줘"** → 🤖가 비밀키 검사·빌드 후 `git push`
- [ ] **14. GitHub Pages 설정**: 아래 12장 순서대로 (저장소 공개, Pages 소스 = GitHub Actions, Variables 2개)
- [ ] **15. 배포 주소에서 확인**: `https://sion1221koreas.github.io/class-5-2/` 에서 5번(로그인), 6번(글쓰기), 11번(식단)
- [ ] **16. 나머지 학생 계정**: `s03@class52.local` … 3번과 같은 방법 (Auto Confirm 체크). 테스트로 쓴 글은 관리자로 지우기

### 알아 둘 것
- 방학 등으로 7일 넘게 아무도 접속하지 않으면 Supabase가 멈춥니다 → 대시보드에서 **Restore**
- 학생 비밀번호 변경: Authentication → Users → 학생 줄 `…` → 비밀번호 변경


---

## 12. 배포를 GitHub Pages로 옮기기 (Netlify 대신)

- 배포 파일: `.github/workflows/deploy.yml` — `master`에 push하면 **비밀키 검사 → 빌드 → 빌드 결과 검사 → Pages 배포**가 자동으로 실행된다.
- `vite.config.js`의 `base`가 `/class-5-2/` → 주소는 `https://sion1221koreas.github.io/class-5-2/`. 내 컴퓨터에서도 `http://localhost:5173/class-5-2/`.
- Supabase 접속 정보(URL, publishable 키)는 **코드에서 뺐다.** 내 컴퓨터는 `.env.local`, 배포는 저장소 **Actions Variables**에서 넣는다. 둘 다 공개용 값이지만 코드에는 두지 않는다.
- `npm run check:secrets`는 이제 올라갈 파일 + dist + **커밋 기록 전체**를 검사하고, 코드에 Supabase 주소·키를 직접 쓰면 실패한다. 배포 워크플로에서도 빌드 전·후에 자동으로 돈다.
- `netlify.toml`은 Netlify가 빌드하지 않도록 `ignore = "exit 0"`만 남겼다 (크레딧 보호).
- GitHub Pages에서는 `X-Frame-Options` 같은 응답 헤더를 정할 수 없다. 검색 차단은 `index.html`의 `noindex` 메타 태그로 유지된다.

### 🧑‍🏫 선생님이 할 일 (순서대로)
1. **Netlify 빌드 멈추기**: Netlify → 프로젝트 → Project configuration → Build & deploy → **Stop builds** (또는 프로젝트 삭제). `netlify.toml`이 막아 주지만 확실하게.
2. **저장소 공개**: GitHub 저장소 → Settings → General → 맨 아래 Danger Zone → **Change visibility → Public**. (무료 계정은 공개 저장소에서만 Pages 사용 가능)
3. **Pages 켜기**: Settings → **Pages** → Build and deployment → Source: **GitHub Actions**
4. **접속 정보 넣기**: Settings → **Secrets and variables → Actions → Variables 탭 → New repository variable**
   - Name `VITE_SUPABASE_URL` / Value: `.env.local`의 같은 값
   - Name `VITE_SUPABASE_PUBLISHABLE_KEY` / Value: `.env.local`의 같은 값 (`sb_publishable_`로 시작해야 함. `sb_secret_`은 절대 안 됨)
5. **"올려줘"** → push → 저장소 **Actions** 탭에서 "GitHub Pages 배포"가 초록색 ✔이 되면 끝 (2~3분)
6. **Supabase 주소 허용**: 로그인 화면이 열리는지 확인. (이메일 확인 메일·리디렉트를 쓰지 않으므로 Supabase URL 설정은 바꿀 필요 없음)

---

## 13. 사이트 닫기(계정 도용 대응) · 메뉴 병합 · 수업/급식 사진 (2026-10-07)

**사이트 닫기**
- `site_settings` 한 줄(닫힘 여부, 안내 문구). **schema.sql 을 처음 실행하면 닫힌 상태로 만들어진다.** 다시 실행해도 지금 상태(열림/닫힘)는 바뀌지 않는다.
- 닫히면 학생·비로그인은 **"사이트 폐쇄" + "도용 사건으로 사이트가 종료되었습니다."** 화면만 본다. 로그인돼 있던 학생은 자동으로 로그아웃된다. 아래 작은 "선생님(관리자) 로그인" 링크로 선생님만 들어간다.
- 화면만 가리는 것이 아니라 **DB가 막는다**: 모든 표·파일·서버 함수에 "닫힘 잠금"(restrictive) 규칙. 도용된 학생 계정으로 API를 직접 불러도 0건.
- 선생님은 그대로 사용, 위쪽에 "학생에게 닫혀 있어요" 빨간 안내. 관리 → **사이트**에서 닫기/열기, 안내 문구 바꾸기, **학생 로그인 모두 끊기**.
- 긴급용 `supabase/emergency-close.sql`: 배포 없이 SQL Editor에서 바로 닫기 + 학생 로그인 끊기.

**메뉴 병합 (캘린더는 홈 그대로)**
- 홈 · **소통**(게시판 | 보드 | 갤러리) · **수업**(오늘의 수업 | 숙제 | 급식) · **퀴즈**(퀴즈 | 순위) · **관리**(학생 관리 | 자리 | 사이트, 선생님만). 메뉴 안에서는 탭으로 이동.

**1인1역 삭제**: 메뉴·화면 삭제. DB 표(jobs 등)와 기록은 남겨 둠 (나중에 필요하면 다시 쓸 수 있게).

**오늘의 수업·급식 = 사진/파일 형식**
- 선생님이 수업·급식마다 사진·파일을 5개까지(하나 50MB) 올린다. 사진은 위치 정보 지우고 줄여서. 글(수업 내용·메뉴)은 선택.
- 보관 위치 `admin/lesson|meal/번호/…`, 기록은 `content_files`. 학생은 보기·내려받기만. 수업·급식을 지우면 사진도 지운다.
- 홈의 오늘 급식: 메뉴 글이 있으면 글, 사진만 있으면 "📷 오늘 식단표 사진 보기".

---

## 14. 회원가입·승인 방식, 개인정보 동의, 접속 기록 경고 (2026-10-07)

- **계정 정리**: `supabase/reset-students.sql` — 관리자 외 모든 계정 삭제 (관리자가 0명이면 멈춤). 지운 학생의 글·댓글·기록도 함께 삭제. 게시판 파일 실물은 Storage 화면에서 따로 정리.
- **회원가입**: 로그인 화면 "처음이에요? 회원가입" → ① 개인정보 수집·이용 동의 ② 개인정보 처리방침(광고 없음, 다른 용도·제3자 제공 없음) **둘 다 동의해야** 다음 → 아이디·이름(선생님 확인용, 실명 표에만)·비밀번호(8자 이상) → **가입 요청**.
- 가입하면 `profiles.status = 'pending'`(승인 대기). 대기 중에는 DB가 모든 자료를 막고(자기 profiles 줄만 보임), 화면은 "승인을 기다리고 있어요"만.
- 선생님: 관리 → 학생 관리 → **가입 요청** 승인 / 거절(계정 삭제). 학생 **계정 삭제**도 여기서. 관리자 계정은 지울 수 없음.
- 동의 시각·판(`privacy_version`)을 계정에 기록. 문구는 `src/privacy.js`, 언제든 `#/privacy`에서 볼 수 있음.
- **처음 입장 경고**: 브라우저를 새로 열 때마다 "IP 주소를 기록하고 있어요 / 다른 사람에게 피해를 주는 일은 절대 하지 마세요" 창.
- **접속 기록**: 로그인한 사람이 들어올 때마다(브라우저 세션당 1번) 서버 함수 `log_visit`가 시각·IP·브라우저를 기록. 선생님만 봄(학생 관리 화면), 1년 지나면 자동 삭제.
- 사이트가 **닫혀 있는 동안**은 가입 화면도 열리지 않음 (선생님만 미리보기). 다시 열 때 Supabase에서 "Allow new users to sign up"을 켜야 가입이 됨.

---

## 15. 학교 Google 계정 로그인 (goedu.kr, 2026-10-07)

- 로그인 화면 "학교 Google 계정으로 로그인" → Supabase Google 로그인(PKCE 방식, 돌아올 때 `?code=`) → 누리집으로 돌아옴.
- **DB가 도메인을 검사**: `goedu.kr` 또는 `○○.goedu.kr` 계정만 가입 가능, 그 밖의 Google 계정은 계정 자체가 만들어지지 않음. Google 화면에도 `hd=goedu.kr` 힌트.
- 처음 들어온 Google 계정: 임시 아이디(`g_…`), 승인 대기, 동의 전 → 화면에서 **동의 2개 → 아이디·이름 정하기**(`complete_signup`) → 승인 대기. "동의하지 않아요"를 누르면 계정을 스스로 지움(`cancel_signup`).
- 동의 전 계정은 선생님도 승인할 수 없음. 학교 이메일은 `student_names.email`(선생님만)에 저장, 가입 요청 목록에 🏫로 표시.
- 개인정보 동의서에 "학교 이메일 주소와 Google 계정 이름" 추가, 판 `2026-10-07.2`.

### 🧑‍🏫 설정 (비밀값은 화면에만)
1. SQL Editor → `supabase/schema.sql` 다시 Run
2. Google Cloud Console → OAuth 동의 화면 + OAuth 클라이언트 ID(웹) 만들기 → 승인된 리디렉션 URI: `https://(프로젝트).supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → **Google** 켜기, 클라이언트 ID·보안 비밀 붙여넣기
4. Supabase → Authentication → URL Configuration → Site URL·Redirect URLs: `https://sion-dev404.github.io/class-5-2/` (내 컴퓨터 시험용: `http://localhost:5173/class-5-2/`)
