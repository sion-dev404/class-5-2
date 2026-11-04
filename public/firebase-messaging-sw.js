// 브라우저가 꺼져 있어도 푸시 알림을 받는 서비스 워커 (Firebase Cloud Messaging)
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCJLmx-UDAfHKGTyE0WNqKDC1ipn2Lm8Pw',
  authDomain: 'class-5-2-aae64.firebaseapp.com',
  projectId: 'class-5-2-aae64',
  storageBucket: 'class-5-2-aae64.firebasestorage.app',
  messagingSenderId: '47151497505',
  appId: '1:47151497505:web:c800c6413cda7c65963e60',
});

// notification 이 들어 있는 메시지는 브라우저가 알아서 보여 줌. 눌렀을 때 열 주소는 서버가 보낸 link 를 씀
firebase.messaging();
