// 실행: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app/logic.js');

const plaidTx = (over = {}) => ({
  transaction_id: 'tx1', account_id: 'acc1', amount: 128.1, iso_currency_code: 'USD', date: '2026-10-05',
  name: 'GEORGIA POWER CO BILL PAY', merchant_name: 'Georgia Power', pending: false, ...over,
});

test('fromPlaid: Plaid 거래를 앱 모양으로 줄이고 끝 4자리를 붙인다', () => {
  assert.deepEqual(L.fromPlaid(plaidTx(), { acc1: '1234' }), {
    id: 'tx1', accountId: 'acc1', date: '2026-10-05', amount: 128.1,
    name: 'GEORGIA POWER CO BILL PAY', merchant: 'Georgia Power', pending: false, category: '', mask: '1234',
  });
  assert.equal(L.fromPlaid(plaidTx({ personal_finance_category: { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_WATER' } })).category,
    'RENT_AND_UTILITIES_WATER');
  assert.equal(L.fromPlaid(plaidTx({ merchant_name: null })).merchant, '');
});

test('nameMatches: 두 단어 업체는 두 단어가 다 맞아야 한다', () => {
  const gp = { vendor: 'Georgia Power' };
  assert.equal(L.nameMatches(gp, { name: 'GEORGIA POWER CO BILL PAY', merchant: '' }), true);
  assert.equal(L.nameMatches(gp, { name: 'GEORGIA NATURAL GAS', merchant: '' }), false);
  assert.equal(L.nameMatches({ vendor: 'Xfinity' }, { name: 'COMCAST XFINITY 800', merchant: '' }), true);
  assert.equal(L.nameMatches({ vendor: 'Gwinnett County Water', bankMatch: 'GWINNETT CNTY' },
    { name: 'GWINNETT CNTY WATER RES', merchant: '' }), true);
});

test('candidates: 예정일 범위·출금·계좌 끝 4자리', () => {
  const bill = { dueDay: 5 };
  const txs = [
    { id: 'in', date: '2026-10-05', amount: -50, mask: '1234' },     // 들어온 돈
    { id: 'early', date: '2026-09-27', amount: 50, mask: '1234' },   // 8일 전 — 범위 밖
    { id: 'ok', date: '2026-09-28', amount: 50, mask: '1234' },      // 7일 전 — 범위 안
    { id: 'late', date: '2026-10-15', amount: 50, mask: '1234' },    // 예정일+3+7 = 15일 — 범위 안
    { id: 'other', date: '2026-10-05', amount: 50, mask: '9999' },   // 다른 계좌
  ];
  const ids = L.candidates(bill, '2026-10', txs, { graceDays: 3, last4: '1234' }).map(t => t.id);
  assert.deepEqual(ids, ['ok', 'late']);
});

test('matchMonth: 예정일에 가까운 거래 하나, 한 거래는 한 항목에만', () => {
  const bills = [
    { id: 'b1', vendor: 'T-Mobile', dueDay: 22, accountId: 'a3' },
    { id: 'b2', vendor: 'T-Mobile', dueDay: 23, accountId: 'a3' },
  ];
  const txs = [
    { id: 't1', date: '2026-10-25', amount: 65, name: 'T-MOBILE PCS SVC', merchant: '', mask: '9012' },
    { id: 't2', date: '2026-10-22', amount: 65, name: 'T-MOBILE PCS SVC', merchant: '', mask: '9012' },
  ];
  const m = L.matchMonth(bills, '2026-10', txs, { last4Of: () => '9012' });
  assert.deepEqual(m.map(x => [x.bill.id, x.tx.id]), [['b1', 't2'], ['b2', 't1']]);
  const paid = L.matchMonth(bills, '2026-10', txs, { last4Of: () => '9012', isPaid: id => id === 'b1' });
  assert.deepEqual(paid.map(x => [x.bill.id, x.tx.id]), [['b2', 't2']]); // b1 이 이미 나감이면 b2 가 가까운 t2 를 쓴다
});

test('change: 30% 이상이면서 $20 이상일 때만 표시', () => {
  assert.equal(L.change(128.10, 311.40).flag, true);   // 전기 두 배 넘게
  assert.equal(L.change(41.80, 58.90).flag, false);    // +41% 지만 $17
  assert.equal(L.change(70, 85).flag, false);          // +21%
  assert.equal(L.change(142, 90).flag, true);          // -37%, -$52
  assert.equal(L.change(null, 50), null);              // 지난달 기록 없음
  assert.equal(L.change(0, 50), null);
});

test('kindGroup: 종류별 묶음', () => {
  assert.equal(L.kindGroup('전기').label, '공과금');
  assert.equal(L.kindGroup('휴대폰').label, '통신');
  assert.equal(L.kindGroup('보험').label, '보험');
  assert.equal(L.kindGroup('기타').label, '기타');
});

test('dueDate: 31일 예정은 짧은 달에 말일로', () => {
  assert.equal(L.dueDate({ dueDay: 31 }, '2026-11'), '2026-11-30');
  assert.equal(L.dueDate({ dueDay: 31 }, '2026-02'), '2026-02-28');
});

test('recurring: 일정한 간격의 출금만 정기 출금으로, 종류·주기·날짜 범위', () => {
  const tx = (id, date, amount, name, extra = {}) => ({ id, accountId: 'a1', date, amount, name, merchant: '', pending: false, category: '', ...extra });
  const water = { category: 'RENT_AND_UTILITIES_WATER' };
  const txs = [
    tx('p1', '2026-08-05', 120, 'GEORGIA POWER CO 123'), tx('p2', '2026-09-04', 140, 'GEORGIA POWER CO 456'), tx('p3', '2026-10-06', 131, 'GEORGIA POWER CO 789'),
    tx('w1', '2026-08-12', 52, 'CITY WATER', water), tx('w2', '2026-10-12', 55, 'CITY WATER', water),
    tx('n1', '2026-08-15', 15.49, 'NETFLIX.COM'), tx('n2', '2026-09-15', 15.49, 'NETFLIX.COM'),
    tx('k1', '2026-08-02', 80, 'KROGER'), tx('k2', '2026-08-09', 31, 'KROGER'), tx('k3', '2026-08-30', 64, 'KROGER'), // 불규칙 장보기
    tx('r1', '2026-09-01', -900, 'PAYROLL'), tx('r2', '2026-10-01', -900, 'PAYROLL'),                               // 들어온 돈
  ];
  assert.deepEqual(L.recurring(txs).map(x => [x.kind, x.cadence, x.dayFrom, x.dayTo, x.fixed]), [
    ['구독', '매달', 15, 15, true],
    ['수도', '두 달마다', 12, 12, false],
    ['전기', '매달', 4, 6, false],
  ]);
});
