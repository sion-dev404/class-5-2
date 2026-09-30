// 비밀키 검사 : GitHub에 올라갈 파일과 빌드 결과(dist)에 공개하면 안 되는 키가 있는지 찾습니다.
// 실행: npm run check:secrets   (문제가 있으면 빨간 줄과 함께 실패로 끝남)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// git이 추적하는(=GitHub에 올라갈) 파일 + dist 폴더
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [...tracked, ...walk('dist')].filter((file) => !/\.(png|jpe?g|gif|ico|woff2?)$/i.test(file));

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.role;
  } catch {
    return null;
  }
}

const problems = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');

  // 새 형식 비밀키: sb_secret_로 시작하는 긴 문자열
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) problems.push(`${file}: sb_secret_ 비밀키`);

  // 옛 형식 키(JWT) 중 service_role 권한인 것
  for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    if (jwtRole(token) === 'service_role') problems.push(`${file}: service_role 키`);
  }

  // .env.local 같은 파일이 실수로 추적되는 경우
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) problems.push(`${file}: 환경 변수 파일이 GitHub에 올라갈 수 있음`);
}

if (problems.length) {
  console.error('\x1b[31m비밀 정보가 발견됐어요! 커밋·배포하지 마세요.\x1b[0m');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`비밀키 검사 통과 (${files.length}개 파일 확인)`);
