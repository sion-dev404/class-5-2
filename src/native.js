import { Capacitor, registerPlugin } from '@capacitor/core';

// 안드로이드 앱(Capacitor) 안에서만 쓰는 도우미. 일반 브라우저에서는 isApp() 이 false
const Browser = registerPlugin('Browser');
const App = registerPlugin('App');

export const isApp = () => Capacitor.isNativePlatform();

// Google 로그인 뒤에 앱으로 돌아오는 주소 (AndroidManifest.xml 의 scheme 과 같아야 함)
export const APP_REDIRECT = 'io.github.siondev404.class52://login-callback';

// Google은 앱 안의 화면(웹뷰)에서 로그인을 막으므로, 크롬 창을 따로 열어 로그인함
export const openLoginWindow = (url) => Browser.open({ url });
export const closeLoginWindow = () => Browser.close().catch(() => {});

// 로그인이 끝나 크롬 창이 앱으로 돌아오면 그 주소를 알려 줌
export function onAppUrl(callback) {
  if (!isApp()) return;
  App.addListener('appUrlOpen', ({ url }) => {
    if (url?.startsWith(APP_REDIRECT)) callback(new URL(url));
  });
}
