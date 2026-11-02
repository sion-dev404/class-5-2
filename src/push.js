import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase.js';

// 안드로이드 앱(Capacitor)에서만 동작하는 푸시 알림 등록. 일반 브라우저에서는 아무것도 하지 않음
const PushNotifications = registerPlugin('PushNotifications');

let started = false;

// Firebase 설정(google-services.json)을 앱에 넣고 서버를 준비한 뒤에만 true 로 바꿈.
// 설정 없이 켜면 앱이 켜지자마자 꺼져 버림 (FirebaseApp is not initialized)
const PUSH_ENABLED = false;

export function isApp() {
  return Capacitor.isNativePlatform();
}

// 로그인한 사람의 기기를 알림 대상으로 등록 (로그인 때마다 한 번)
export async function setupPush() {
  if (!PUSH_ENABLED || !isApp() || started) return;
  started = true;
  try {
    let { receive } = await PushNotifications.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      ({ receive } = await PushNotifications.requestPermissions());
    }
    if (receive !== 'granted') return;

    await PushNotifications.addListener('registration', async ({ value }) => {
      await supabase.rpc('save_push_token', { p_token: value });
    });
    await PushNotifications.addListener('registrationError', (error) => console.error('푸시 등록 실패', error));
    // 알림을 누르면 해당 글로 이동
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const url = notification.data?.url;
      if (typeof url === 'string' && url.startsWith('#/')) location.hash = url;
    });
    await PushNotifications.register();
  } catch (error) {
    console.error('푸시 준비 실패', error);
    started = false;
  }
}

// 로그아웃할 때: 이 기기로는 더 이상 이 계정의 알림이 오지 않게 함
export async function teardownPush() {
  if (!PUSH_ENABLED || !isApp()) return;
  started = false;
  try {
    await PushNotifications.removeAllListeners();
    await supabase.rpc('remove_push_tokens');
  } catch {
    // 무시
  }
}
