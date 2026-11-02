import { supabase } from './supabase.js';

// 날짜(YYYY-MM-DD)의 급식 → { data: { id, meal_date, menu } | null, error }
export function fetchMeal(date) {
  return supabase.from('meals').select('id, meal_date, menu').eq('meal_date', date).maybeSingle();
}

// 메뉴 글 → 한 줄에 한 가지 음식
export function menuItems(menu) {
  return menu
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
