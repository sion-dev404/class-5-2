import { createClient } from '@supabase/supabase-js';
import { SUPABASE } from './config.js';

// 공개해도 되는 값만 쓴다. 환경 변수(.env.local, Netlify)가 있으면 그것을, 없으면 config.js 기본값을 쓴다.
const url = import.meta.env.VITE_SUPABASE_URL || SUPABASE.url;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || SUPABASE.publishableKey;

export const configError =
  !url || !publishableKey ? 'Supabase 접속 정보가 없어요. src/config.js 의 SUPABASE 값을 확인해 주세요.' : null;

export const supabase = configError ? null : createClient(url, publishableKey);
