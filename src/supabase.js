import { createClient } from '@supabase/supabase-js';

// 공개해도 되는 값만 읽는다. 값은 코드가 아니라 빌드할 때 환경 변수로 들어온다.
//   · 내 컴퓨터: .env.local
//   · GitHub Pages: 저장소 Actions Variables (배포 워크플로가 빌드할 때 넣어 줌)
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !publishableKey
    ? 'Supabase 접속 정보가 없어요. 내 컴퓨터라면 .env.local 을, GitHub Pages라면 저장소의 Actions Variables(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)를 확인해 주세요.'
    : null;

// Google 로그인은 PKCE 방식: 돌아올 때 주소의 ?code= 를 Supabase가 바꿔 줌 (# 주소와 섞이지 않음)
export const supabase = configError ? null : createClient(url, publishableKey, { auth: { flowType: 'pkce' } });
