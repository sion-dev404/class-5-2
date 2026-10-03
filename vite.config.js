import { defineConfig } from 'vite';

// GitHub Pages 주소가 https://아이디.github.io/class-5-2/ 이므로
// 모든 파일 경로를 /class-5-2/ 아래로 맞춘다. (내 컴퓨터에서도 http://localhost:5173/class-5-2/)
export default defineConfig({
  base: '/class-5-2/',
});
