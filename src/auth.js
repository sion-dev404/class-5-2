import { supabase } from './supabase.js';
import { ID_DOMAIN } from './config.js';
import { PRIVACY_VERSION } from './privacy.js';

// 아이디: 영어 소문자·숫자·_ 만 (예: s01, redsionkim)
const USERNAME_PATTERN = /^[a-z0-9_]{2,30}$/;

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return USERNAME_PATTERN.test(username);
}

// 로그인한 사람 정보 { id, username, nickname, role, status, profileMissing }
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

// 회원가입 요청: 동의 기록과 이름을 함께 보냄 → DB가 "승인 대기" 계정을 만듦
export async function signUp(username, password, realName) {
  const id = normalizeUsername(username);
  if (!isValidUsername(id)) {
    return { error: { message: '아이디는 영어 소문자·숫자·_ 로 2~30자로 해 주세요.' } };
  }
  cachedUser = undefined;
  const { data, error } = await supabase.auth.signUp({
    email: `${id}@${ID_DOMAIN}`,
    password,
    options: {
      data: { real_name: realName, privacy_version: PRIVACY_VERSION, privacy_agreed_at: new Date().toISOString() },
    },
  });
  if (error) {
    let text = `가입 요청을 보내지 못했어요: ${error.message}`;
    if (/already registered|already exists/i.test(error.message)) text = '이미 있는 아이디예요. 다른 아이디를 써 주세요.';
    else if (/signups? not allowed|disabled/i.test(error.message)) text = '지금은 가입을 받지 않아요. 선생님께 물어봐 주세요.';
    else if (/password/i.test(error.message)) text = '비밀번호가 너무 쉬워요. 8자 이상으로 해 주세요.';
    else if (/database error/i.test(error.message)) text = '아이디 형식을 확인해 주세요. (영어 소문자·숫자·_ 2~30자)';
    return { error: { message: text } };
  }
  // 같은 아이디가 이미 있으면 Supabase는 오류 대신 빈 계정을 돌려줄 때가 있음
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: { message: '이미 있는 아이디예요. 다른 아이디를 써 주세요.' } };
  }
  return { error: null, signedIn: !!data?.session };
}

// Google 계정으로 로그인 (Google 화면으로 갔다가 이 누리집으로 돌아옴)
export async function signInWithGoogle() {
  cachedUser = undefined;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.origin + location.pathname,
      queryParams: { prompt: 'select_account' }, // 여러 계정 중 고를 수 있게
    },
  });
  return { error };
}

// Google로 처음 들어온 학생: 동의 + 아이디·이름 → 가입 요청
export async function completeSignup(username, realName) {
  const { error } = await supabase.rpc('complete_signup', { p_username: normalizeUsername(username), p_real_name: realName.trim(), p_privacy_version: PRIVACY_VERSION });
  cachedUser = undefined;
  return { error: error ? { message: error.message } : null };
}

// 동의하지 않음: 승인 대기 중인 내 계정 지우기
export async function cancelSignup() {
  const { error } = await supabase.rpc('cancel_signup');
  if (!error) await signOut();
  return { error };
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

  const query = (columns) => supabase.from('profiles').select(columns).eq('id', session.user.id).maybeSingle();
  let { data: profile, error } = await query('id, username, nickname, role, status, privacy_agreed_at');
  if (error?.code === '42703') {
    // 승인 상태 칸이 아직 없으면(SQL 실행 전) 예전처럼
    ({ data: profile } = await query('id, username, nickname, role'));
    if (profile) {
      profile.status = 'approved';
      profile.privacy_agreed_at = 'old';
    }
  }

  cachedUser = profile ?? {
    // 계정 정보를 읽을 수 없음: 학생으로, 승인 대기로 취급
    id: session.user.id,
    username: session.user.email.split('@')[0],
    nickname: null,
    role: 'student',
    status: 'pending',
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

// Google로 들어와서 아직 동의·가입 요청을 하지 않은 상태
export function needsOnboarding(user) {
  return !!user && !isAdmin(user) && user.status === 'pending' && !user.privacy_agreed_at && !user.profileMissing;
}

export function isApproved(user) {
  return isAdmin(user) || user?.status === 'approved';
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
