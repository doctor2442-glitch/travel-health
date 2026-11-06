# 여행 건강 지킴이

여행지 날씨(해 뜸·해 짐 포함), 관광지, 축제, 근처 약국·응급실, 상비약 정보(e약은요)를 한 화면에서 보여 주는 HTML 한 개짜리 페이지입니다.

- `index.html` : GitHub Pages로 올리는 화면. 맨 위 `var RELAY_URL = "";` 에 Apps Script 웹 앱 주소(…/exec)를 넣습니다. 비어 있으면 예시 화면이 나옵니다.
- `Code.gs` : 구글 Apps Script 중계(참고용). 공공데이터포털 인증키는 스크립트 속성 `PUBLIC_API_KEY` 에만 넣고, 이 저장소에는 없습니다.

## Apps Script 설정
1. script.google.com 에서 프로젝트를 열고 `Code.gs` 내용을 붙여 넣고 저장.
2. 프로젝트 설정 → 스크립트 속성 → `PUBLIC_API_KEY` = 공공데이터포털 인증키(Decoding).
3. 처음이면: 배포 → 새 배포 → 웹 앱, 실행: 나, 액세스: 모든 사용자.
   이미 배포했으면: 배포 관리 → 연필(편집) → 버전 "새 버전" → 배포 (주소 유지).
4. 편집기에서 `checkAll` 실행 → 실행 로그에서 기능별 ✅/❌ 확인.

## 확인 필요
- `sun`(한국천문연구원 출몰시각)의 요청 항목(locdate, longitude, latitude, dnYn)과 응답 칸(sunrise, sunset, civilm, civile)은 활용가이드로 확인 필요. `checkAll` 의 `[sun]` 줄에 첫 항목 칸 이름이 찍힙니다.
