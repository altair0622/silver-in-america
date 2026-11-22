'use strict';
/*
 * 이 PC 에 받아 둔 은행 거래(server/.data/)에서 정기 출금 후보를 뽑는다 — 부모님 화면 기본 항목을 정하려고.
 * 화면에는 종류·주기·날짜 범위·고정/변동만 낸다. 금액·계좌번호·가맹점 원문은 내지 않는다.
 * --names 를 붙이면 확인용으로 가게 이름 줄임말도 화면에만 보인다(파일로 저장하지 않는다).
 * 실행: node tools/recurring.js [--names]
 */
const fs = require('node:fs');
const path = require('node:path');
const { recurring } = require('../app/logic.js');

const env = (() => {
  try { return /^PLAID_ENV=(\w+)/m.exec(fs.readFileSync(path.join(__dirname, '..', 'server', '.env'), 'utf8'))?.[1] || 'sandbox'; }
  catch { return 'sandbox'; }
})();
const file = path.join(__dirname, '..', 'server', '.data', `store-${env}.json`);
if (!fs.existsSync(file)) { console.log(`거래가 없어요: ${path.relative(process.cwd(), file)} — 먼저 앱에서 은행 연결·동기화`); process.exit(1); }

const store = JSON.parse(fs.readFileSync(file, 'utf8'));
const txs = Object.values(store.tx);
const dates = txs.map(t => t.date).sort();
const showNames = process.argv.includes('--names');
const acctName = id => (store.accounts[id]?.name || '계좌').replace(/\d/g, '');

console.log(`Plaid ${env} · 거래 ${txs.length}건 · ${dates[0] || '-'} ~ ${dates.at(-1) || '-'}`);
const rows = recurring(txs);
if (!rows.length) console.log('정기 출금 후보 없음');
for (const r of rows) {
  const day = r.dayFrom === r.dayTo ? `${r.dayFrom}일` : `${r.dayFrom}~${r.dayTo}일`;
  console.log(`- ${r.kind} · ${r.cadence} · ${day} · ${r.fixed ? '고정' : '변동'} · ${r.times}번 · ${acctName(r.accountId)}${showNames ? ` · (${r.label})` : ''}`);
}
