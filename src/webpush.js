import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { FIREBASE_CONFIG, VAPID_KEY } from './firebase-config.js';
import { supabase } from './supabase.js';

// 브라우저(크롬·사파리 홈 화면 앱)용 푸시 알림. 앱(APK)에서는 push.js 를 씀

// 이 브라우저에서 알림을 켤 수 있나? (VAPID 키가 있고, 브라우저가 지원할 때)
export async function canUseWebPush() {
  if (!VAPID_KEY || !('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export const webPushPermission = () => ('Notification' in window ? Notification.permission : 'denied');

// 알림 켜기: 권한을 묻고, 이 기기 주소(토큰)를 받아 DB에 저장. 버튼을 누를 때 불러야 함
export async function enableWebPush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { error: '알림을 허용하지 않았어요. 브라우저 설정에서 허용해 주세요.' };

  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`);
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(initializeApp(FIREBASE_CONFIG));
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return { error: '알림 주소를 받지 못했어요. 잠시 뒤 다시 해 주세요.' };

  const { error } = await supabase.rpc('save_push_token', { p_token: token });
  return error ? { error: '저장하지 못했어요. 잠시 뒤 다시 해 주세요.' } : { ok: true };
}
