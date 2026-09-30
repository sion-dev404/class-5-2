import { supabase } from './supabase.js';
import { SCHOOL } from './config.js';

// 날짜(YYYY-MM-DD)의 급식 → [{ type: '중식', dishes: [{ name, allergens }], calories }]
export async function fetchMeals(date) {
  const { data, error } = await supabase.functions.invoke('meal', {
    body: {
      date: date.replaceAll('-', ''),
      atptCode: SCHOOL.atptCode,
      schoolCode: SCHOOL.schoolCode,
    },
  });
  if (error) throw new Error(await mealErrorText(error));
  return data.meals;
}

async function mealErrorText(error) {
  const response = error.context;
  if (response instanceof Response) {
    if (response.status === 404) return "급식 기능이 아직 준비되지 않았어요. (선생님: Edge Function 'meal' 배포 필요)";
    if (response.status === 401) return '로그인이 끝났어요. 다시 로그인해 주세요.';
    try {
      const body = await response.json();
      if (body?.error) return body.error;
    } catch {
      // 본문이 JSON이 아니면 아래 기본 문장
    }
  }
  return '급식 정보를 가져오지 못했어요. 잠시 뒤 다시 해 주세요.';
}

export const ALLERGENS = [
  '난류', '우유', '메밀', '땅콩', '대두', '밀', '고등어', '게', '새우', '돼지고기',
  '복숭아', '토마토', '아황산류', '호두', '닭고기', '쇠고기', '오징어', '조개류(굴, 전복, 홍합 포함)', '잣',
];
