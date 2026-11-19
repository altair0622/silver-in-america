'use strict';
/*
 * 화면과 상관없는 계산 — 브라우저(app.js)와 Node(server.js, tests/)가 같이 쓴다.
 * 여기 함수는 db·DOM 을 만지지 않는다. 필요한 값은 인자로 받는다.
 */
(function (root) {
  const pad = n => String(n).padStart(2, '0');

  function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(y, m - 1, d + n);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }
  // 예정일이 31일인데 그 달이 30일까지면 말일로 본다
  function dueDate(bill, ym) { return `${ym}-${pad(Math.min(bill.dueDay, daysInMonth(ym)))}`; }

  /* ---------- 묶음 ---------- */

  // 아버님 피드백(11-18): 통장·카드별 말고 종류별(공과금·보험·통신)로도 보고 싶다
  const KIND_GROUPS = [
    { key: 'utility', label: '공과금', kinds: ['전기', '수도', '가스', '쓰레기'] },
    { key: 'telecom', label: '통신', kinds: ['인터넷', '휴대폰'] },
    { key: 'insurance', label: '보험', kinds: ['보험'] },
  ];
  const OTHER_GROUP = { key: 'other', label: '기타', kinds: [] };
  function kindGroup(kind) { return KIND_GROUPS.find(g => g.kinds.includes(kind)) || OTHER_GROUP; }

  /* ---------- Plaid 거래 → 앱 거래 ---------- */

  // Plaid /transactions/sync 의 Transaction 한 건을 앱이 쓰는 모양으로 줄인다.
  // amount 는 Plaid 규칙 그대로: 양수 = 돈이 나감, 음수 = 들어옴.
  function fromPlaid(t, masks = {}) {
    return {
      id: t.transaction_id, accountId: t.account_id, date: t.date, amount: t.amount,
      name: t.name || '', merchant: t.merchant_name || '', pending: Boolean(t.pending),
      mask: masks[t.account_id] || '',
    };
  }

  /* ---------- 은행 거래 맞추기 ---------- */

  // 업체명을 은행 거래 이름과 비교할 단어로 나눈다 (짧거나 흔한 단어는 뺀다)
  const STOP = new Set(['the', 'inc', 'llc', 'co', 'corp', 'company', 'of', 'and', 'county', 'city', 'bill', 'pay', 'payment']);
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w));

  function nameMatches(bill, t) {
    const hay = ` ${words(`${t.name} ${t.merchant}`).join(' ')} `;
    const want = words(bill.bankMatch || bill.vendor);
    if (!want.length) return false;
    const hit = want.filter(w => hay.includes(` ${w} `)).length;
    return hit >= Math.min(2, want.length); // 두 단어 이상이면 두 개는 맞아야 한다 (예: Georgia + Power)
  }

  // 예정일 7일 전 ~ 예정일+유예+7일 사이의 출금(양수 금액). 계좌 끝 4자리가 둘 다 있으면 같아야 한다.
  function candidates(bill, ym, txs, { graceDays = 3, last4 = '' } = {}) {
    const due = dueDate(bill, ym);
    const from = addDays(due, -7), to = addDays(due, graceDays + 7);
    return txs.filter(t => t.amount > 0 && t.date >= from && t.date <= to && !(last4 && t.mask && last4 !== t.mask));
  }

  // 아직 기록이 없는 항목마다 이름이 맞는 거래 중 예정일에 가장 가까운 것 하나. 한 거래는 한 항목에만 쓴다.
  function matchMonth(bills, ym, txs, { graceDays = 3, last4Of = () => '', isPaid = () => false, used = new Set() } = {}) {
    const out = [];
    for (const b of bills) {
      if (isPaid(b.id)) continue;
      const due = Date.parse(dueDate(b, ym));
      const hit = candidates(b, ym, txs, { graceDays, last4: last4Of(b.accountId) })
        .filter(t => !used.has(t.id) && nameMatches(b, t))
        .sort((x, y) => Math.abs(Date.parse(x.date) - due) - Math.abs(Date.parse(y.date) - due))[0];
      if (!hit) continue;
      used.add(hit.id);
      out.push({ bill: b, tx: hit });
    }
    return out;
  }

  /* ---------- 지난달과 비교 ---------- */

  // 사람이 눈으로 잡아내도록 표시만 한다(자동 판정 아님).
  // 30% 이상 그리고 $20 이상 바뀌면 표시 — 공과금은 계절 따라 10~30% 움직이고(추정), 작은 요금의 몇 달러 차이는 빼려고. 시험 사용 후 조정.
  const CHANGE_PCT = 0.3, CHANGE_USD = 20;
  function change(prev, cur) {
    if (prev == null || cur == null || !(prev > 0)) return null;
    const diff = cur - prev;
    const pct = diff / prev;
    return { diff, pct, flag: Math.abs(pct) >= CHANGE_PCT && Math.abs(diff) >= CHANGE_USD };
  }

  const api = { pad, daysInMonth, addMonths, addDays, dueDate, KIND_GROUPS, OTHER_GROUP, kindGroup,
    fromPlaid, words, nameMatches, candidates, matchMonth, CHANGE_PCT, CHANGE_USD, change };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.L = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
