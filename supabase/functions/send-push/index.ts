// Supabase Edge Function: 안드로이드 앱으로 푸시 알림 보내기 (Firebase Cloud Messaging v1)
// 부르는 곳: DB(push.sql 의 send_push). 요청 머리글의 x-push-secret 이 맞아야만 보냄.
// 필요한 비밀 값(supabase secrets set): PUSH_SECRET, FIREBASE_SERVICE_ACCOUNT(서비스 계정 JSON 통째로)
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줌
import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();

const base64url = (input: ArrayBuffer | string) => {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// 서비스 계정으로 Google 접근 토큰 받기
async function accessToken(account: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${claim}`));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${base64url(signature)}`,
    }),
  });
  const json = await response.json();
  if (!json.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    // 원인을 응답에 남겨 DB의 net._http_response 에서 볼 수 있게 함 (비밀 값은 넣지 않음)
    return new Response(`오류: ${(error as Error).message}`, { status: 500 });
  }
});

async function handle(request: Request) {
  if (request.method !== 'POST' || request.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const { user_ids, title, body, url } = await request.json();
  if (!Array.isArray(user_ids) || user_ids.length === 0) return new Response('no targets');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tokens, error } = await admin.from('push_tokens').select('token').in('user_id', user_ids);
  if (error) return new Response(error.message, { status: 500 });
  if (!tokens?.length) return new Response('no tokens');

  const account = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!);
  const bearer = await accessToken(account);
  const dead: string[] = [];
  const failures: string[] = [];

  await Promise.all(
    tokens.map(async ({ token }) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: { url: String(url ?? '') },
            android: { priority: 'HIGH' },
            // 브라우저 알림을 눌렀을 때 열 주소 (https 만 가능)
            webpush: { fcm_options: { link: `https://sion-dev404.github.io/class-5-2/${String(url ?? '')}` } },
          },
        }),
      });
      if (response.status === 404) dead.push(token); // 앱을 지운 기기 (UNREGISTERED)
      else if (!response.ok) failures.push(`${response.status} ${(await response.text()).slice(0, 200)}`);
    }),
  );
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
  const sent = tokens.length - dead.length - failures.length;
  return new Response(`sent ${sent}${failures.length ? ` / 실패 ${failures.length}: ${failures[0]}` : ''}`);
}
