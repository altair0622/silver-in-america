# HANDOFF — silver-in-america

갱신: 2026-11-22 · 컴팩트: 0회 · 담당: 도윤(프로젝트 타워, 세션 제목 `도윤 · silver-in-america`)
상태: 운영 중 https://altair0622.github.io/silver-in-america/ (화면만, 예시 자료). 11-18 아버님 피드백 2건 반영 — 묶음 보기(통장·카드별/종류별, 기억), 지난 기록 달별 금액표·합계·지난달 대비 표시. 샘플은 Plaid 형식 거래에서 만듦.
다음: (대표 11-22) 부모님 목록 받기 전에 대표 본인 계좌의 정기 출금부터 본다 — Production 승인 → 본인 계좌 연결 → `node tools/recurring.js` 로 종류·주기만 뽑아 '부모님 기본 항목'과 '부모님께 물어볼 것'을 여기 적고 원자료(server/.data/store-production.json) 삭제.
막힘: 실제 계좌 연결 불가 — 지금 키는 시험 은행용(11-21 Keys 화면에 Production 'You don't have access'). 대표가 누를 곳: ① dashboard.plaid.com 로그인(2단계 인증) → 왼쪽 Developers → Keys ② Production secret 옆 'Try for free' → 회사·쓰는 목적(개인 공과금 확인, Transactions) 적고 신청, 무료 범위·요금 확인 ③ 승인되면 Production secret 을 server/.env PLAID_SECRET 에 붙이고 PLAID_ENV=production → 도윤에게 "넣었어".
결정: 실제 은행(production) 연결 방식 — ① Plaid 무료 체험 범위로 본인 계좌 1~2개만 (추천, 요금·심사 조건은 가입 후 대시보드에서 확인) ② 유료 요금제 · 풀리면 PLAID_ENV=production 으로 본인 계좌 연결
긴 일: 없음 (Production 승인 뒤 실제 거래로 매칭 기준 조정)
정해짐(대표 10-28): 공개 저장소 + GitHub Pages. 은행 확인은 Plaid 로 바로, 본인 계좌부터.
AI 결정(11-18): 지난달 대비 표시 기준 = 30% 이상 그리고 $20 이상. 이유: 공과금은 계절 따라 10~30% 움직이고(추정) 작은 요금의 몇 달러는 빼려고. 되돌리려면 app/logic.js 의 CHANGE_PCT·CHANGE_USD.
AI 결정(11-18): 화면을 우리 스타일 A1 로 옮김 — 포인트색 A1 파랑 · 글자 A3 단계(본문 21→18px) · 모서리 기본. 상태 표시는 이모지 대신 글자 기호(✓ ○ !). 되돌리려면 style.css :root.
AI 결정: 인간다움 장치 = 첫 화면 맨 위 "가족 한마디"(자녀가 직접 쓴 메모). Plaid 서버는 이 PC(127.0.0.1)에서만.
할 일(도윤): ① CLAUDE.md 맨 위 "세션을 시작하면 이것부터" 절·직무 카드 — 대표가 이 방에서 시킬 때(다른 세션 요청으로는 CLAUDE.md 를 안 고침) ② 이전 빈 폴더 C:\dev\sliver-in-america 삭제 ③ _team 도윤 PLAYBOOK·SCORECARD 에 11-18 줄 넣기 — 다른 세션이 그 파일 미커밋분을 커밋한 뒤(지안 11-18), 넣을 글은 아래 "넣을 노트".
더 볼 곳: OUTPUTS.md, docs/captures/ (갤럭시 412×915 캡처), docs/brief.md, README.md

---

## 한 일 (2026-11-22, 대표 결정 — 지안 경유)
- 본인 계좌 정기 출금 보기 준비: `app/logic.js` 에 `kindOf`(Plaid personal_finance_category → 전기·가스/수도/쓰레기/휴대폰/인터넷/보험/카드값/대출/구독/의료, 없으면 이름 단어)와
  `recurring`(같은 곳·같은 계좌, 간격이 매주~해마다 중 하나로 일정하면 정기) 추가, `fromPlaid` 가 분류(category)도 남김. 테스트 8개 통과.
- `tools/recurring.js`: 이 PC 의 거래에서 종류·주기·날짜 범위·고정/변동·횟수만 출력(금액·계좌번호·가맹점 원문 없음, `--names` 는 화면 확인용). sandbox 에서 동작 확인(가짜 은행은 모든 거래가 매달 반복이라 의미 있는 결과는 실제 계좌에서).
- 공개 저장소라 실제 결과는 종류·주기만 머리말에 적고, 원자료는 끝나면 지운다(지안 11-22).

## 한 일 (2026-11-21)
- Plaid 가입·2단계 인증·sandbox 키(대표) → sandbox 연결·동기화·앱 자동 확인 시험 통과.
- 재연결 안내: 동기화 중 ITEM_LOGIN_REQUIRED·PENDING_EXPIRATION·PENDING_DISCONNECT 이면 그 은행만 `needsRelink` 표시하고 다른 은행은 계속.
  `/api/link-token {itemId}` = update mode(같은 연결 되살림, 토큰 교환 없음), 끝나면 `/api/relinked` 가 표시를 지우고 다시 동기화.

## 한 일 (2026-11-18, 아버님 피드백 — 지안 경유)
- **묶음 보기:** 이번 달·지난 기록 위에 `통장·카드별 | 종류별` 전환. 종류별 = 공과금(전기·수도·가스·쓰레기)·통신(인터넷·휴대폰)·보험·기타.
  고른 값은 `db.groupBy` 로 저장(백업 파일에도 들어감). 종류별일 때 각 줄에는 어느 통장·카드인지를 보여 줌.
- **지난 기록 금액표:** 최근 세 달(이번 달 포함)을 항목 × 달 표로. 칸은 금액 / 아직 / ! 없음 / —(등록 전). 맨 아래 달 합계(나간 것만).
  지난달 대비 30%·$20 이상 바뀐 칸은 노란 바탕 + ▲/▼ %. 자동 판정이 아니라 사람이 보고 청구서와 맞춰 보게 하는 표시. 칸을 누르면 그 달 확인 화면.
- **Plaid 형식 샘플:** `samplePlaidTransactions()` 가 Plaid Transaction 모양(transaction_id·account_id·amount 양수=출금·date·name·merchant_name·pending·personal_finance_category)으로
  4달치를 만들고, 서버와 같은 `L.fromPlaid` → `L.matchMonth` 를 지나 "나감" 기록이 됨. 예: 이번 달 Georgia Power $311(평소 $128~143), 지난달 T-Mobile 누락, Kroger 장보기(매칭 안 됨).
  예전 샘플이 저장된 폰은 열 때 새 샘플로 바뀜(`sampleVersion` 2). 실제 자료는 건드리지 않음.
- **공용 계산 분리:** `app/logic.js` — 날짜·매칭·Plaid 변환·변화 표시. 브라우저·server.js·tests 가 같이 씀. `node --test tests/*.test.js` 7개 통과.
- 우리 스타일 조정: 포인트색 A1 파랑 · 글자 A3 단계(본문 18) · 모서리 기본 — 어르신이 쓰는 앱이라 글자만 한 단계 키움. 다크 모드 추가.

### 넣을 노트 (_team/doyun, 대기 중)
- PLAYBOOK: `[11-18·silver-in-america] 예시 자료는 손으로 결과를 만들지 말고, 실제 자료 형식(Plaid Transaction)으로 만들어 실제 처리 함수를 통과시킨다. 계산을 logic.js 하나로 빼 브라우저·서버·테스트가 같이 쓰면 어긋나지 않는다.`
- PLAYBOOK: `[11-18·silver-in-america] 이미 폰에 저장된 샘플은 코드를 바꿔도 안 바뀐다 — 샘플에 판 번호(sampleVersion)를 두고 옛 판일 때만 새로 만든다.`
- PLAYBOOK: `[11-18·silver-in-america] Windows 에서 헤드리스 Edge/Chrome 은 창이 약 500px 아래로 안 줄어 412px 캡처 오른쪽이 잘린다(추정 — 증상은 확인). 넓은 창 안에 412×915 iframe 을 두고 찍어 잘라 낸다.`
- SCORECARD: `| 2026-11-18 | silver-in-america | 아버님 피드백 2건(지안 경유): 묶음 보기, 달별 금액표·합계·지난달 대비, Plaid 형식 샘플, logic.js·테스트 7개, A1 스타일, 갤럭시 캡처. 배포 5a1b1e9 | 0 | 0 | 0 |`

### 캡처 (11-18, 운영 주소, 412×915 @2x)
docs/captures/2026-11-18-1-this-month-light.png · -2-history-light.png · -3-history-dark.png — 예시 자료만.

## 한 일 (2026-10-28)
- 시작 브리프 `docs/brief.md`, README·CLAUDE.md, git. `app/` PWA 1단계: 이번 달 한눈에, 확인 체크(안 나감이면 납부 방식별 이유 후보), 항목 등록/수정(숨김 — 기록 보존), 지난 기록, 설정(계좌·가족 한마디·유예일·백업).
- 상태 규칙: 기록 있음 → 나감 / 오늘 ≤ 예정일+유예(기본 3일) → 아직 / 그 뒤 → 안 나감. 등록한 달(`since`) 이전은 세지 않음. 확인 화면은 예상 범위 ±10% 밖이면 "평소와 달라요".
- 은행 연동: `server/server.js`(외부 패키지 없음) — Plaid Link → 토큰 교환(AES-GCM 암호화) → `/transactions/sync`. 다른 사이트 요청·app/ 밖 파일 차단.
  매칭 = 출금 · 예정일 -7일 ~ 예정일+유예+7일 · 계좌 끝 4자리 일치 · 업체명 단어 두 개 이상이면 두 개 일치. 못 찾으면 확인 화면에 후보 목록.

## 검증
- 확인됨(11-18): 412×915 라이트·다크에서 이번 달(두 묶음)·지난 기록 표·확인 화면, 묶음 선택이 화면 사이·새로고침 뒤 유지, 206px(글자 200%)에서 7개 화면 가로 넘침 0
  (이번 달 머리줄이 140px 넘치던 것 고침), 예전 샘플 → 새 샘플 전환, 서버가 logic.js 를 불러 정상 시작.
- 확인됨(10-28): 운영 주소 표시·서비스 워커 등록, 키 없는 서버 상태·Origin·경로 차단, 가짜 거래 자동 매칭.
- 확인됨(실기기, 11-18 21:26 대표 갤럭시·다크 모드, 지안 전달): 지난 기록 세 달 금액, Georgia Power $311 ▲143% 노란 칸, '아직' 표시 모두 보임, 잘림 없음.
  대표가 "왜 검은 바탕이냐"고 물음 → 폰 다크 모드 설정을 따라간다고 설명, 동작은 그대로 둠.
- 확인됨(11-21, Plaid sandbox): 키 설정 → `/api/sandbox-connect`(First Platypus Bank, 계좌 5개) → 동기화 거래 48건(첫 호출은 0건, 몇 초 뒤 48건 — Plaid 가 처음 거래를 준비하는 시간)
  → localhost:8787 앱에 시험 항목(SparkFun 끝 0000, Touchstone Climbing 끝 3333, Georgia Power) 넣고 '은행에서 확인하기' → 2건 자동 '나감', Georgia Power 는 거래 없어 '안 나감'. sandbox 기본 거래에는 공과금이 없어 다른 가게 이름으로 시험.
- 확인됨(11-21, 재연결): `/api/sandbox-break`(sandbox reset_login) → 동기화가 ITEM_LOGIN_REQUIRED 를 잡아 `relink` 로 돌려줌 → 이번 달·설정 화면에 '연결이 잠시 끊겼어요 · 다시 연결하기'
  → 누르면 update mode 링크 토큰으로 Plaid 창이 열림. 서비스 워커가 Plaid 스크립트까지 가로채던 것 고침(같은 주소만).
- 미검증: 홈 화면 추가·오프라인, 백업 불러오기 실제 파일, Plaid 창 안에서 끝까지 다시 로그인 → 안내가 사라지는지(대표가 sandbox 시험 로그인으로 해 볼 수 있음), Production.

## 남은 일 / 다음 단계
1. 아버님 피드백 다음 판 — 표가 읽히는지, 노란 칸 기준이 맞는지.
2. Plaid 키 → sandbox → 본인 계좌. 부모님 폰에서 쓰려면 서버 호스팅 결정(대표).
3. 서연(사용자 패널) 검토 의뢰 — 어르신 눈으로 금액표 읽기.
4. 의도서 `intent/silver-in-america.md` 는 지안(총괄 타워)이 만듦.
