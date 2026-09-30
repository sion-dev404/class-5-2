// 누리집 설정 (비밀 정보 없음)

export const CLASS_NAME = '5학년 2반';

// 로그인 아이디 → 내부용 이메일로 바꿀 때 붙이는 주소 (실제로 메일이 가지 않음)
export const ID_DOMAIN = 'class52.local';

// 급식 정보를 가져올 학교 (나이스 교육정보 개방 포털 학교 코드)
export const SCHOOL = {
  name: '성남제일초등학교',
  atptCode: 'J10', // 시도교육청 코드: 경기도교육청
  schoolCode: '7551046', // 표준학교코드
};

// Supabase 공개 접속 정보 (브라우저용 공개 값이라 GitHub에 있어도 안전. 데이터는 RLS가 지킴)
// Netlify 환경 변수가 없어도 누리집이 동작하도록 기본값으로 둔다.
// ⚠️ sb_secret_ 로 시작하는 비밀키나 service_role 키는 절대 여기에 넣지 않는다.
export const SUPABASE = {
  url: 'https://tposixqppswlhcgifane.supabase.co',
  publishableKey: 'sb_publishable_Ca_1Y9fhjyi0HjIzyAca3Q_xQ7d1adT',
};
