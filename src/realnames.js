import { supabase } from './supabase.js';
import { isAdmin } from './auth.js';

// 학생 실명 (관리자만 읽을 수 있음 — 학생이 부르면 DB가 빈 목록을 돌려줌)
let cache = null;

// user_id → 실명 (관리자가 아니면 항상 빈 Map)
export async function realNames(user) {
  if (!isAdmin(user)) return new Map();
  if (cache) return cache;
  const { data, error } = await supabase.from('student_names').select('user_id, real_name');
  if (error) return new Map(); // 표가 아직 없거나 오류면 실명 없이 표시
  cache = new Map(data.map((row) => [row.user_id, row.real_name]));
  return cache;
}

export function forgetRealNames() {
  cache = null;
}

// "별명 (아이디) · 실명" (실명이 있을 때만 덧붙임)
export function withRealName(label, userId, names) {
  const real = names.get(userId);
  return real ? `${label} · ${real}` : label;
}
