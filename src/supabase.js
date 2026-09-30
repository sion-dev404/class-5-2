import { createClient } from '@supabase/supabase-js';

// 공개해도 되는 값만 읽는다. (값은 .env.local 또는 Netlify 환경 변수에 있음)
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configError =
  !url || !publishableKey
    ? '환경 변수가 없어요. .env.local 에 VITE_SUPABASE_URL 과 VITE_SUPABASE_PUBLISHABLE_KEY 를 넣고 개발 서버를 다시 켜 주세요.'
    : null;

export const supabase = configError ? null : createClient(url, publishableKey);
