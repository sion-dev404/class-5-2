// =====================================================================
// Supabase Edge Function "meal" : 나이스 급식 정보 중계
//
// 하는 일
//   1. 부른 사람이 우리 반 계정으로 로그인했는지 확인 (아니면 401)
//   2. 나이스 교육정보 개방 포털에서 그날 급식을 받아 옴
//   3. 메뉴 이름·알레르기 번호·칼로리만 깔끔하게 정리해서 돌려줌
//
// 비밀 값
//   NEIS_API_KEY : 나이스 인증키. Supabase → Edge Functions → Secrets 에만 넣습니다.
//                  (없어도 동작하지만, 나이스가 "샘플"로 취급해 요청 수가 제한됩니다)
//   SUPABASE_URL : Supabase가 자동으로 넣어 주는 값 (직접 넣을 필요 없음)
// =====================================================================

const NEIS_URL = 'https://open.neis.go.kr/hub/mealServiceDietInfo';
const CACHE_MS = 10 * 60 * 1000; // 같은 날짜는 10분 동안 다시 묻지 않음

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Dish = { name: string; allergens: number[] };
type Meal = { type: string; dishes: Dish[]; calories: string | null };

// "콩나물밥*(초) (5.6.16)" → { name: "콩나물밥", allergens: [5, 6, 16] }
export function parseDish(raw: string): Dish | null {
  let text = raw.replace(/&amp;/g, '&').trim();
  let allergens: number[] = [];
  const match = text.match(/\s*\(([\d.\s]+)\)\s*$/);
  if (match) {
    allergens = match[1]
      .split('.')
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 19);
    text = text.slice(0, match.index).trim();
  }
  // 학교급 표시 "(초)", 조리 표시 "*", "#" 같은 기호 지우기
  const name = text.replace(/\((초|중|고)\)/g, '').replace(/[*#]+/g, '').trim();
  return name ? { name, allergens } : null;
}

// 나이스 응답(JSON) → Meal[]  (데이터 없음이면 빈 배열)
export function parseMealResponse(json: any): Meal[] {
  if (json?.RESULT?.CODE === 'INFO-200') return [];
  const rows = json?.mealServiceDietInfo?.[1]?.row;
  if (!Array.isArray(rows)) {
    const result = json?.RESULT ?? json?.mealServiceDietInfo?.[0]?.head?.[1]?.RESULT;
    throw new Error(`나이스 응답 오류: ${result?.CODE ?? '알 수 없음'} ${result?.MESSAGE ?? ''}`.trim());
  }
  return rows
    .map((row: any) => ({
      code: Number(row.MMEAL_SC_CODE) || 0,
      type: String(row.MMEAL_SC_NM ?? '급식'),
      dishes: String(row.DDISH_NM ?? '')
        .split(/<br\s*\/?>/i)
        .map(parseDish)
        .filter((dish: Dish | null): dish is Dish => dish !== null),
      calories: row.CAL_INFO ? String(row.CAL_INFO).trim() : null,
    }))
    .sort((a: { code: number }, b: { code: number }) => a.code - b.code)
    .map(({ type, dishes, calories }: Meal & { code: number }) => ({ type, dishes, calories }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 우리 프로젝트의 로그인 토큰인지 Supabase Auth에 직접 물어봄
async function isLoggedIn(req: Request): Promise<boolean> {
  const authorization = req.headers.get('Authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  if (!authorization.startsWith('Bearer ') || !apikey) return false;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey },
  });
  return res.ok;
}

const cache = new Map<string, { expires: number; meals: Meal[] }>();

async function fetchMeals(atptCode: string, schoolCode: string, date: string): Promise<Meal[]> {
  const cacheKey = `${atptCode}/${schoolCode}/${date}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.meals;

  const params = new URLSearchParams({
    Type: 'json',
    pIndex: '1',
    pSize: '10',
    ATPT_OFCDC_SC_CODE: atptCode,
    SD_SCHUL_CODE: schoolCode,
    MLSV_YMD: date,
  });
  const key = Deno.env.get('NEIS_API_KEY');
  if (key) params.set('KEY', key);

  const res = await fetch(`${NEIS_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`나이스 서버 응답 ${res.status}`);
  const meals = parseMealResponse(await res.json());

  if (cache.size > 200) cache.clear();
  cache.set(cacheKey, { expires: Date.now() + CACHE_MS, meals });
  return meals;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST로 요청해 주세요.' }, 405);

  if (!(await isLoggedIn(req))) return json({ error: '로그인이 필요해요.' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: '요청 형식이 잘못됐어요.' }, 400);
  }
  const { date, atptCode, schoolCode } = body ?? {};
  if (!/^\d{8}$/.test(date ?? '') || !/^[A-Z]\d{2}$/.test(atptCode ?? '') || !/^\d{7}$/.test(schoolCode ?? '')) {
    return json({ error: '날짜 또는 학교 코드가 잘못됐어요.' }, 400);
  }

  try {
    const meals = await fetchMeals(atptCode, schoolCode, date);
    return json({ date, meals });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : '급식 정보를 가져오지 못했어요.' }, 502);
  }
}

// Supabase(Deno)에서만 서버를 켬 (Node로 테스트할 때는 위 함수만 가져다 씀)
if (typeof Deno !== 'undefined') Deno.serve(handler);
