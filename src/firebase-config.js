// Firebase 웹 설정. 웹용 값은 원래 공개되는 값이라 코드에 둬도 안전함 (비밀키 아님)
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCJLmx-UDAfHKGTyE0WNqKDC1ipn2Lm8Pw',
  authDomain: 'class-5-2-aae64.firebaseapp.com',
  projectId: 'class-5-2-aae64',
  storageBucket: 'class-5-2-aae64.firebasestorage.app',
  messagingSenderId: '47151497505',
  appId: '1:47151497505:web:c800c6413cda7c65963e60',
};

// Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서의 "공개 키".
// 비어 있으면 브라우저 알림 버튼이 보이지 않음
export const VAPID_KEY = 'BCwzSo_cExrGol-PWb4SdBFAbtZq7qpqnLN9XxgJipkTz0kX6QHKO6nk7E0ITq485xk-kyKT_5Cx4MCyj1XLdyI';
