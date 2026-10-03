// 쿼리 검사 : src 안의 .from('표').select('칸') 을 실제 Supabase에 보내 모양이 맞는지 확인합니다.
// 로그인 없이(공개 키로) 보내므로 데이터는 받지 않고, 정상이면 "권한 없음(42501)"이 돌아옵니다.
// 표·칸 이름이 틀리거나 연결이 애매하면(PGRST200/201/205, 42703) 실패로 알려 줍니다.
// 실행: npm run check:queries   (push 전에 실행)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 접속 정보: 환경 변수 → 없으면 .env.local (코드에는 두지 않음)
function envValue(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env.local')) return '';
  const line = readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}
const SUPABASE = {
  url: envValue('VITE_SUPABASE_URL').replace(/\/$/, ''),
  publishableKey: envValue('VITE_SUPABASE_PUBLISHABLE_KEY'),
};
if (!SUPABASE.url || !SUPABASE.publishableKey) {
  console.error('VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY 가 없어요. (.env.local 또는 환경 변수)');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') ? [path] : [];
  });
}

// .from('posts').select('...') 와 board.js 의 fetchPage('...') 를 찾음
const queries = new Map();
for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\.from\('(\w+)'\)\s*\.select\('([^']+)'/g)) queries.set(`${m[1]}|${m[2]}`, file);
  for (const m of text.matchAll(/fetchPage\('([^']+)'/g)) queries.set(`posts|${m[1]}`, file);
}

let bad = 0;
for (const [key, file] of queries) {
  const [table, select] = key.split('|');
  const url = new URL(`${SUPABASE.url}/rest/v1/${table}`);
  url.searchParams.set('select', select.replace(/\s+/g, ''));
  url.searchParams.set('limit', '1');
  const body = await (await fetch(url, { headers: { apikey: SUPABASE.publishableKey } })).json();
  const code = Array.isArray(body) ? 'OK' : body.code;
  if (code !== '42501' && code !== 'OK') {
    bad += 1;
    console.error(`\x1b[31mFAIL\x1b[0m ${file} ${table}: ${select}\n     → ${code} ${body.message}`);
  }
}
if (bad) {
  console.error(`\n쿼리 ${queries.size}개 중 ${bad}개 문제. 배포하지 마세요.`);
  process.exit(1);
}
console.log(`쿼리 검사 통과 (${queries.size}개)`);
