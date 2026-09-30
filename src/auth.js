import { supabase } from './supabase.js';
import { ID_DOMAIN } from './config.js';

// 아이디: 영어 소문자·숫자·_ 만 (예: s01, redsionkim)
const USERNAME_PATTERN = /^[a-z0-9_]{2,30}$/;

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return USERNAME_PATTERN.test(username);
}

// 로그인한 사람 정보 { id, username, nickname, role, profileMissing }
// undefined = 아직 확인 안 함, null = 로그인 안 됨
let cachedUser;

export async function signIn(username, password) {
  const id = normalizeUsername(username);
  if (!isValidUsername(id)) {
    return { error: { message: '아이디는 영어 소문자와 숫자로 입력해 주세요.' } };
  }
  cachedUser = undefined;
  const { error } = await supabase.auth.signInWithPassword({
    email: `${id}@${ID_DOMAIN}`,
    password,
  });
  if (error) {
    const invalid = error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message);
    return { error: { message: invalid ? '아이디 또는 비밀번호가 달라요.' : `로그인하지 못했어요: ${error.message}` } };
  }
  return { error: null };
}

export async function signOut() {
  cachedUser = null;
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  if (cachedUser !== undefined) return cachedUser;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    cachedUser = null;
    return cachedUser;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, nickname, role')
    .eq('id', session.user.id)
    .maybeSingle();

  cachedUser = profile ?? {
    // schema.sql 실행 전에 만든 계정 등: 학생으로 취급
    id: session.user.id,
    username: session.user.email.split('@')[0],
    nickname: null,
    role: 'student',
    profileMissing: true,
  };
  return cachedUser;
}

export function forgetUser() {
  cachedUser = undefined;
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

// 다른 탭에서 로그아웃했거나 로그인이 만료되었을 때 알려 주기
export function onSignedOut(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      cachedUser = null;
      setTimeout(callback, 0);
    }
  });
}
