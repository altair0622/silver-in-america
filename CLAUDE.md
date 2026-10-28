# silver-in-america — 프로젝트 지침

공통 지침은 `~/.claude/CLAUDE.md`. 여기는 이 프로젝트에만 해당하는 것.

- 작업 전 `HANDOFF.md` 머리말을 먼저 읽는다. 배경·범위는 `docs/brief.md`.
- **금융 정보 최소화:** 계좌번호·카드번호 전체, 은행 로그인 정보는 코드·샘플·커밋 어디에도 넣지 않는다. 끝 4자리까지만.
- **부모님 실제 공과금 자료는 커밋하지 않는다.** 실제 목록은 앱의 백업 JSON 으로만 다루고 저장소 밖(Dropbox)에 둔다.
  `.gitignore` 가 `silver-bills-*.json` 을 막는다.
- 은행 연동은 Plaid 로 한다(2026-10-28 사용자 결정). 서버는 `server/server.js` — 이 PC 의 127.0.0.1 에서만 열린다.
  Plaid 키는 `server/.env`, 은행 접근 토큰·거래내역은 `server/.data/` (둘 다 git 제외, 토큰은 AES-GCM 암호화). 절대 커밋하지 않는다.
  서버를 인터넷에 올리는 일(호스팅·로그인·가족 공유)과 Plaid 실서비스(production) 신청·요금은 사용자 결정이 필요하다.
- AI 는 아직 쓰지 않는다. 은행 거래 매칭은 규칙(업체명 단어·계좌 끝 4자리·예정일 범위)으로 한다.
- 시니어 UX 원칙: 큰 글씨, 큰 버튼, 한 화면에 한 가지 일, 업체명은 영어 그대로·나머지는 한국어, 아이콘엔 항상 글자.
- 빌드 도구 없이 바닐라 JS 를 유지한다. `app/` 파일을 바꾸면 `app/sw.js` 의 `VERSION` 을 올린다.
- 실행: 은행 연동까지 → `node server/server.js` (http://localhost:8787). 화면만 → `python -m http.server 8737 --directory app`.
- 운영(GitHub Pages)에는 앱 화면만 올라가고 은행 기능은 숨겨진다(서버가 없으므로).
