// 비밀키 검사 : 공개 저장소에 올라가면 안 되는 것이 있는지 찾습니다.
//   1) GitHub에 올라갈 파일 (git이 추적하는 파일 + 새 파일)
//   2) 빌드 결과(dist)
//   3) 지난 커밋 기록 전체 (한 번이라도 올라간 비밀키는 기록에 남으므로)
// 실행: npm run check:secrets   (문제가 있으면 빨간 줄과 함께 실패로 끝남)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const tracked = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isBinary = (file) => /\.(png|jpe?g|gif|ico|webp|woff2?|pdf)$/i.test(file);

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
}

// 어디에도 있으면 안 되는 것 (비밀키)
function secretProblems(text) {
  const found = [];
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) found.push('sb_secret_ 비밀키');
  for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    if (jwtRole(token) === 'service_role') found.push('service_role 키');
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) found.push('개인 키(PRIVATE KEY)');
  if (/postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/.test(text)) found.push('DB 비밀번호가 들어 있는 접속 주소');
  return found;
}

const problems = [];

// 1) 올라갈 파일
for (const file of tracked) {
  if (!existsSync(file) || isBinary(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const p of secretProblems(text)) problems.push(`${file}: ${p}`);
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) problems.push(`${file}: 환경 변수 파일이 GitHub에 올라갈 수 있음`);
  // 접속 정보도 코드에 두지 않기로 함 (저장소 Variables / .env.local 에서 넣음)
  if (file !== 'package-lock.json') {
    if (/sb_publishable_[A-Za-z0-9_-]{16,}/.test(text)) problems.push(`${file}: publishable 키가 코드에 있음 → .env.local / 저장소 Variables 로`);
    if (/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text)) problems.push(`${file}: Supabase 주소가 코드에 있음 → .env.local / 저장소 Variables 로`);
  }
}

// 2) 빌드 결과 (공개 키·주소는 원래 들어가는 것이 정상, 비밀키만 검사)
for (const file of walk('dist')) {
  if (isBinary(file)) continue;
  for (const p of secretProblems(readFileSync(file, 'utf8'))) problems.push(`${file}: ${p}`);
}

// 3) 지난 커밋 기록 전체
let history = '';
try {
  history = git('log', '--all', '-p', '--no-color');
} catch {
  // 커밋이 없거나 git이 없으면 건너뜀
}
for (const p of new Set(secretProblems(history))) problems.push(`커밋 기록: ${p} (기록에서 지우거나 키를 새로 바꿔야 함)`);

if (problems.length) {
  console.error('\x1b[31m공개되면 안 되는 것이 발견됐어요! 커밋·push 하지 마세요.\x1b[0m');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`비밀키 검사 통과 (파일 ${tracked.length}개, dist, 커밋 기록 확인)`);
