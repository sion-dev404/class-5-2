import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages 주소가 https://아이디.github.io/class-5-2/ 이므로
// 모든 파일 경로를 /class-5-2/ 아래로 맞춘다. (내 컴퓨터에서도 http://localhost:5173/class-5-2/)
// 관리자 페이지는 따로 열린다: /class-5-2/admin/
export default defineConfig({
  base: '/class-5-2/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
});
