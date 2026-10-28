# silver-in-america — 미국 한인 시니어를 위한 도구

미국에 사는 한인 시니어가 "자녀에게 매번 묻기 미안한 일"을 스스로, 그리고 가족과 함께 해결하도록 돕는 프로젝트.
첫 사용자는 부모님. 배경과 전체 계획은 [docs/brief.md](docs/brief.md).

## 지금 만드는 것: 공과금 확인 (1단계)

이번 달 공과금이 실제로 나갔는지 계좌별로 한 화면에서 확인한다. 안 나갔으면 이유 후보를 한국어로 보여준다.

- 상태 세 가지: ✓ 나감 · ⏳ 아직(예정일 전 또는 유예 기간) · ⚠ 안 나감
- 수동 등록 + 수동 체크. 은행 연동 없음, 서버 없음, AI 없음.
- 자료는 그 기기의 브라우저 저장소에만 있다 → 설정에서 백업 파일(JSON) 저장/불러오기.
- 계좌는 별칭과 끝 4자리만 저장한다. 전체 계좌번호·카드번호는 받지 않는다.

## 은행 연동 (Plaid, 이 컴퓨터에서만)

`server/server.js` 가 Plaid 를 통해 은행 거래내역을 가져오고, 앱의 "🏦 은행에서 확인하기" 버튼이
업체명·계좌 끝 4자리·예정일 범위가 맞는 출금을 찾아 "나감"으로 표시한다. 못 찾으면 항목 화면에서 후보 거래를 골라 체크할 수 있다.

1. https://dashboard.plaid.com 가입 → Developers → Keys 에서 client_id 와 sandbox secret 확인
2. `server/.env.example` 을 `server/.env` 로 복사하고 값 채우기 (`TOKEN_KEY` 는 파일 안 명령으로 생성)
3. `node server/server.js` → http://localhost:8787 → 설정 → "시험 은행 바로 연결"(sandbox) 또는 "은행 연결하기"

키와 은행 접근 토큰, 거래내역은 이 컴퓨터의 `server/.env`, `server/.data/` 에만 있고 git 에 올라가지 않는다.

## 화면만 실행

```bash
python -m http.server 8737 --directory app
```

운영 주소 https://altair0622.github.io/silver-in-america/ 에는 화면만 있고 은행 기능은 숨겨진다.
처음 열면 연습용 샘플 자료가 들어 있다(설정에서 지울 수 있음).

## 구조

```
app/index.html          껍데기 + 아래 탭
app/app.js              자료·상태 계산·화면 5개 (이번 달 / 확인 / 항목 / 지난 기록 / 설정)
app/style.css           시니어 UX: 기본 21px, 버튼 최소 56px, 아이콘엔 항상 글자
app/sw.js, manifest     홈 화면 추가·오프라인
server/server.js        Plaid 연동 로컬 서버 (외부 패키지 없음, Node 22+)
docs/brief.md           시작 브리프 (claude.ai 대화에서 정리)
HANDOFF.md              현재 상태·다음 할 일
```
