'use strict';
/*
 * 공과금 확인 — 1단계 (서버 없음, AI 없음)
 * 데이터는 이 기기의 localStorage 에만 저장한다. 계좌번호 전체·카드번호는 저장하지 않는다(끝 4자리만).
 * 화면: #/ 이번 달 · #/month/YYYY-MM · #/check/<billId>/<YYYY-MM> · #/bill/<id|new> · #/history · #/settings
 */

const STORE_KEY = 'silver-bills-v1';
const SAMPLE_VERSION = 2; // 2: Plaid 형식 거래에서 만든 4달치 샘플

const KINDS = ['전기', '수도', '가스', '인터넷', '휴대폰', '보험', '쓰레기', '기타'];
const METHODS = { auto: '자동이체', card: '카드 자동결제', manual: '직접 냄' };

// '안 나감'일 때 보여주는 이유 후보. 납부 방식에 따라 다르게 보인다.
const REASONS = {
  auto: ['자동이체가 해제되었을 수 있어요', '통장 잔액이 부족했을 수 있어요', '이번 달 청구서가 아직 안 나왔을 수 있어요', '출금일이 바뀌었을 수 있어요'],
  card: ['카드 유효기간이 지났을 수 있어요', '카드를 새로 받아 번호가 바뀌었을 수 있어요', '이번 달 청구서가 아직 안 나왔을 수 있어요', '카드 한도가 찼을 수 있어요'],
  manual: ['직접 내셔야 하는 항목이에요 — 아직 안 내셨을 수 있어요', '이번 달 청구서가 아직 안 왔을 수 있어요', '우편물이 다른 곳으로 갔을 수 있어요'],
};

/* ---------- 저장 ---------- */

function emptyData() {
  return { version: 1, sample: false, graceDays: 3, groupBy: 'account', familyNote: '', familyName: '', accounts: [], bills: [], payments: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    // 예전 판 샘플이 남아 있으면 새 샘플로 바꾼다 (실제 자료는 건드리지 않는다)
    if (raw) { const d = JSON.parse(raw); if (!(d.sample && d.sampleVersion !== SAMPLE_VERSION)) return Object.assign(emptyData(), d); }
  } catch (e) { /* 읽지 못하면 샘플로 시작 */ }
  return sampleData();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { alert('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); }
}

let db; // 날짜 함수가 정의된 뒤 아래 '길 찾기'에서 불러온다

/* ---------- 날짜 (계산은 logic.js) ---------- */

const { pad, daysInMonth, addMonths, addDays, dueDate } = L;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisMonth = () => today().slice(0, 7);
function monthLabel(ym) { const [y, m] = ym.split('-'); return `${y}년 ${Number(m)}월`; }
function dayLabel(date) { const [, m, d] = date.split('-'); return `${Number(m)}월 ${Number(d)}일`; }
const shortMonth = ym => `${Number(ym.slice(5))}월`;

/* ---------- 상태 계산 ---------- */

function paymentFor(billId, ym) { return db.payments.find(p => p.billId === billId && p.month === ym); }

// 상태는 세 가지만: paid(나감) / wait(아직) / missed(안 나감)
function statusOf(bill, ym) {
  const p = paymentFor(bill.id, ym);
  if (p) return { key: 'paid', label: '✓ 나감', payment: p };
  const due = dueDate(bill, ym);
  const deadline = addDays(due, db.graceDays);
  const now = today();
  if (now < due) return { key: 'wait', label: '○ 아직', detail: `${dayLabel(due)} 예정` };
  if (now <= deadline) return { key: 'wait', label: '○ 아직', detail: `${dayLabel(due)} 예정 · ${dayLabel(deadline)}까지 기다려 봐요` };
  return { key: 'missed', label: '! 안 나감', detail: `${dayLabel(due)} 예정이었어요` };
}

function amountText(bill) {
  if (bill.amountMin == null || bill.amountMin === '') return '금액 정해지지 않음';
  if (bill.amountMax && Number(bill.amountMax) !== Number(bill.amountMin)) return `$${bill.amountMin} ~ $${bill.amountMax}`;
  return `$${bill.amountMin}`;
}
function outOfRange(bill, amount) {
  if (amount == null || amount === '' || bill.amountMin == null || bill.amountMin === '') return false;
  const lo = Number(bill.amountMin), hi = Number(bill.amountMax || bill.amountMin);
  return amount < lo * 0.9 || amount > hi * 1.1; // 예상 범위에서 10% 넘게 벗어나면 알려준다
}

const accountOf = id => db.accounts.find(a => a.id === id);
const accountText = a => a ? `${a.name}${a.last4 ? ` (끝 ${a.last4})` : ''}` : '계좌 미지정';
const activeBills = () => db.bills.filter(b => b.active !== false);
// 등록한 달(since) 이전은 기록 대상이 아니다 — '안 나감'으로 세지 않는다
const billsIn = ym => activeBills().filter(b => !b.since || b.since <= ym);
const firstMonth = () => activeBills().reduce((m, b) => (b.since && b.since < m ? b.since : m), thisMonth());
const uid = () => Math.random().toString(36).slice(2, 10);

// 고른 묶음(통장·카드별 / 종류별)으로 나눈다. 묶음 안은 예정일 순.
function groupBills(bills) {
  const byDue = (x, y) => x.dueDay - y.dueDay;
  if (db.groupBy === 'kind') {
    return [...L.KIND_GROUPS, L.OTHER_GROUP]
      .map(g => ({ title: g.label, items: bills.filter(b => L.kindGroup(b.kind).key === g.key).sort(byDue) }))
      .filter(g => g.items.length);
  }
  const groups = db.accounts.map(a => ({
    title: `${accountText(a)}${a.bank ? ` · ${a.bank}` : ''}`, items: bills.filter(b => b.accountId === a.id).sort(byDue) }));
  const orphan = bills.filter(b => !accountOf(b.accountId));
  if (orphan.length) groups.push({ title: '계좌 미지정', items: orphan.sort(byDue) });
  return groups.filter(g => g.items.length);
}

function groupSwitchHtml() {
  const opt = (key, label) => `<button type="button" data-group="${key}" aria-pressed="${db.groupBy === key}">${label}</button>`;
  return `<div class="seg" role="group" aria-label="묶어 보기">${opt('account', '통장·카드별')}${opt('kind', '종류별')}</div>`;
}
function bindGroupSwitch(redraw) {
  view.querySelectorAll('[data-group]').forEach(btn => btn.onclick = () => {
    if (db.groupBy === btn.dataset.group) return;
    db.groupBy = btn.dataset.group; save(); redraw();
  });
}
const money = n => `$${Number(n).toFixed(2)}`;

/* ---------- 그리기 도움 ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = document.getElementById('view');
const titleEl = document.getElementById('title');

function render(title, html, tab) {
  titleEl.textContent = title;
  document.title = `${title} — 공과금 확인`;
  view.innerHTML = html;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

function familyNoteHtml() {
  if (!db.familyNote) return '';
  return `<div class="family-note">${esc(db.familyNote)}${db.familyName ? `<small>— ${esc(db.familyName)}</small>` : ''}</div>`;
}
const sampleBanner = () => db.sample ? '<p class="sample-banner">지금은 연습용 샘플 자료예요. 설정에서 지우고 실제 항목을 넣을 수 있어요.</p>' : '';

/* ---------- 화면 1: 한 달 한눈에 ---------- */

function screenMonth(ym) {
  const isNow = ym === thisMonth();
  const bills = billsIn(ym);
  const counts = { paid: 0, wait: 0, missed: 0 };
  const st = new Map(bills.map(b => { const s = statusOf(b, ym); counts[s.key]++; return [b.id, s]; }));

  let html = familyNoteHtml() + sampleBanner();
  html += `<div class="month-nav">
    ${ym > firstMonth() ? `<a class="btn ghost small-btn" href="#/month/${addMonths(ym, -1)}">◀ 이전</a>` : '<span class="spacer"></span>'}
    <strong>${monthLabel(ym)}</strong>
    ${isNow ? '<span class="spacer"></span>' : `<a class="btn ghost small-btn" href="#/month/${addMonths(ym, 1)}">다음 ▶</a>`}
  </div>`;
  html += `<div class="summary">
    <span class="s-paid">✓ 나감 ${counts.paid}</span>
    <span class="s-wait">○ 아직 ${counts.wait}</span>
    <span class="s-missed">! 안 나감 ${counts.missed}</span>
  </div>`;
  if (counts.missed) html += '<p class="lead bad">빨간 항목을 눌러 이유를 보세요.</p>';
  else if (bills.length && counts.wait === 0) html += '<p class="lead ok">이번 달 모두 나갔어요.</p>';
  if (isNow) html += relinkHtml();
  if (bankReady() && counts.paid < bills.length) {
    html += '<button class="btn" id="bankcheck">은행에서 확인하기</button><p id="bankmsg" class="hint" aria-live="polite"></p>';
  }
  if (bills.length) html += groupSwitchHtml();

  for (const g of groupBills(bills)) {
    html += `<h3>${esc(g.title)}</h3>`;
    for (const b of g.items) {
      const s = st.get(b.id);
      const sub = s.key === 'paid'
        ? `${dayLabel(s.payment.paidDate)} 나감${s.payment.amount != null ? ` · ${money(s.payment.amount)}` : ''}${s.payment.txId ? ' · 은행 확인' : ''}`
        : s.detail;
      // 종류별로 볼 때는 어느 통장·카드에서 나가는지를, 통장별로 볼 때는 종류를 보여 준다
      const where = db.groupBy === 'kind' ? (accountOf(b.accountId)?.name || '계좌 미지정') : b.kind;
      html += `<a class="bill ${s.key === 'missed' ? 'missed' : ''}" href="#/check/${b.id}/${ym}">
        <div class="who"><b>${esc(b.vendor)}</b><span>${esc(where)} · ${esc(sub)}</span></div>
        <span class="badge s-${s.key}">${s.label}</span></a>`;
    }
  }
  if (!bills.length) html += `<p class="muted">${isNow ? '아직 등록한 항목이 없어요.' : '이 달에는 기록한 항목이 없어요.'}</p>`;
  html += '<a class="btn ghost" href="#/bill/new">+ 새 항목 등록</a>';
  html += `<div class="scam"><b>잠깐!</b> "전기가 곧 끊긴다, 기프트카드로 지금 내라"는 전화는 <b>사기</b>예요.
    전화를 끊고 이 화면에서 "나감"인지 먼저 확인하세요. 진짜 회사는 기프트카드를 요구하지 않아요.</div>`;
  render(isNow ? '이번 달 한눈에' : monthLabel(ym), html, isNow ? 'home' : 'history');
  bindGroupSwitch(() => screenMonth(ym));
  bindRelink(() => screenMonth(ym));

  const bc = document.getElementById('bankcheck');
  if (bc) bc.onclick = async () => {
    bc.disabled = true; bc.textContent = '은행에서 가져오는 중…';
    try {
      const marked = await autoCheck(ym);
      screenMonth(ym);
      if (needsRelink() && !marked.length) return;   // 위의 '다시 연결' 안내가 이유를 말해 준다
      document.getElementById('bankmsg') && (document.getElementById('bankmsg').textContent = marked.length
        ? `${marked.join(', ')} — 은행 거래를 찾아 "나감"으로 표시했어요. 맞는지 한 번 봐 주세요.`
        : '새로 찾은 출금이 없어요. 항목을 눌러 은행 거래 목록에서 직접 고를 수도 있어요.');
    } catch (e) {
      bc.disabled = false; bc.textContent = '은행에서 확인하기';
      document.getElementById('bankmsg').textContent = `가져오지 못했어요: ${e.message}`;
    }
  };
}

/* ---------- 화면 2: 확인 체크 ---------- */

function screenCheck(billId, ym) {
  const b = db.bills.find(x => x.id === billId);
  if (!b) return go('#/');
  const s = statusOf(b, ym);
  const p = s.payment;
  let html = `<p class="muted">${monthLabel(ym)} · ${esc(accountText(accountOf(b.accountId)))}</p>
    <h2>${esc(b.vendor)} <span class="badge s-${s.key}">${s.label}</span></h2>
    <p>${esc(b.kind)} · 매월 ${b.dueDay}일 · ${esc(amountText(b))} · ${METHODS[b.method] || ''}</p>`;

  if (s.key === 'missed') {
    html += `<div class="card warn"><b>왜 안 나갔을까요? (가능한 이유)</b><ul>
      ${(REASONS[b.method] || REASONS.auto).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small">먼저 은행 앱이나 명세서에서 출금이 있었는지 확인해 보세요. 그래도 없으면 회사 홈페이지나 청구서에 적힌 번호로 직접 확인하세요.</p></div>`;
  }

  if (p) {
    html += `<div class="card"><b>${dayLabel(p.paidDate)}에 나갔어요</b>
      ${p.amount != null ? `<p>금액: ${money(p.amount)}</p>` : ''}
      ${outOfRange(b, p.amount) ? '<p style="color:var(--bad)">평소 금액과 많이 달라요. 청구서를 한 번 확인해 보세요.</p>' : ''}
      ${p.note ? `<p>메모: ${esc(p.note)}</p>` : ''}</div>
      <button class="btn danger" id="undo">"나감" 취소하기</button>`;
  } else {
    const defDate = ym === thisMonth() ? today() : dueDate(b, ym);
    html += `<form id="f">
      <label for="d">언제 나갔나요?</label>
      <input id="d" type="date" required value="${defDate}" min="${ym}-01" max="${ym}-${daysInMonth(ym)}">
      <label for="a">얼마 나갔나요? (달러)</label>
      <input id="a" type="number" inputmode="decimal" step="0.01" min="0" placeholder="모르면 비워 두세요" value="${esc(b.amountMin ?? '')}">
      <label for="n">메모 (선택)</label>
      <input id="n" type="text" placeholder="예: 은행 앱에서 확인">
      <button class="btn" type="submit">✓ 나갔어요</button></form>`;
    if (bankReady()) html += '<h3>은행 거래 중에 있나요?</h3><div id="cands" class="hint">은행 거래를 불러오는 중…</div>';
  }
  html += `<a class="btn ghost" href="#/bill/${b.id}">항목 고치기</a>
    <a class="btn ghost" href="${ym === thisMonth() ? '#/' : `#/month/${ym}`}">← 돌아가기</a>`;
  render('확인하기', html, ym === thisMonth() ? 'home' : 'history');

  const f = document.getElementById('f');
  if (f) f.onsubmit = e => {
    e.preventDefault();
    const amt = document.getElementById('a').value;
    db.payments.push({ billId: b.id, month: ym, paidDate: document.getElementById('d').value,
      amount: amt === '' ? null : Number(amt), note: document.getElementById('n').value.trim() });
    save();
    go(ym === thisMonth() ? '#/' : `#/month/${ym}`);
  };
  const cands = document.getElementById('cands');
  if (cands) monthTransactions(ym).then(txs => {
    const used = new Set(db.payments.map(x => x.txId).filter(Boolean));
    const list = candidates(b, ym, txs).filter(t => !used.has(t.id))
      .sort((x, y) => Number(nameMatches(b, y)) - Number(nameMatches(b, x)) || x.date.localeCompare(y.date));
    if (!list.length) { cands.textContent = '예정일 앞뒤로 은행에서 나간 돈이 없어요.'; return; }
    cands.className = '';
    cands.innerHTML = list.map(t => `<button class="bill" data-tx="${esc(t.id)}">
      <div class="who"><b>${esc(t.name)}</b><span>${dayLabel(t.date)} · $${t.amount.toFixed(2)}${t.mask ? ` · 끝 ${esc(t.mask)}` : ''}${t.pending ? ' · 처리 중' : ''}</span></div>
      ${nameMatches(b, t) ? '<span class="badge s-paid">이름 비슷</span>' : ''}</button>`).join('')
      + '<p class="hint">맞는 거래를 누르면 그 날짜·금액으로 "나감" 처리돼요.</p>';
    cands.querySelectorAll('[data-tx]').forEach(btn => btn.onclick = () => {
      const t = list.find(x => x.id === btn.dataset.tx);
      db.payments.push({ billId: b.id, month: ym, paidDate: t.date, amount: t.amount, txId: t.id, note: `은행 거래: ${t.name}` });
      save(); go(ym === thisMonth() ? '#/' : `#/month/${ym}`);
    });
  }).catch(e => { cands.textContent = `은행 거래를 불러오지 못했어요: ${e.message}`; });

  const undo = document.getElementById('undo');
  if (undo) undo.onclick = () => {
    if (!confirm('"나감" 표시를 취소할까요?')) return;
    db.payments = db.payments.filter(x => x !== p);
    save(); screenCheck(billId, ym);
  };
}

/* ---------- 화면 3: 항목 등록/수정 ---------- */

function screenBill(id) {
  const isNew = id === 'new';
  const b = isNew ? { vendor: '', kind: '전기', accountId: db.accounts[0]?.id || '', dueDay: 1, amountMin: '', amountMax: '', method: 'auto' }
                  : db.bills.find(x => x.id === id);
  if (!b) return go('#/');
  if (!db.accounts.length) {
    return render('항목 등록', '<p>먼저 계좌를 하나 등록해 주세요.</p><a class="btn" href="#/settings">계좌 등록하러 가기</a>', 'home');
  }
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`;
  const html = `<form id="f">
    <label for="v">회사 이름 (영어 그대로)</label>
    <input id="v" required value="${esc(b.vendor)}" placeholder="예: Georgia Power" autocomplete="off">
    <label for="k">종류</label>
    <select id="k">${KINDS.map(k => opt(k, k, b.kind)).join('')}</select>
    <label for="ac">어느 계좌에서 나가나요?</label>
    <select id="ac">${db.accounts.map(a => opt(a.id, accountText(a), b.accountId)).join('')}</select>
    <label for="dd">매월 며칠에 나가나요?</label>
    <select id="dd">${Array.from({ length: 31 }, (_, i) => opt(i + 1, `${i + 1}일`, b.dueDay)).join('')}</select>
    <div class="row">
      <div><label for="lo">보통 금액 ($)</label><input id="lo" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(b.amountMin)}"></div>
      <div><label for="hi">많을 때 ($)</label><input id="hi" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(b.amountMax)}"></div>
    </div>
    <p class="hint">금액이 매달 같으면 "많을 때"는 비워 두세요.</p>
    <label for="m">내는 방법</label>
    <select id="m">${Object.entries(METHODS).map(([k, t]) => opt(k, t, b.method)).join('')}</select>
    <label for="bm">은행 거래에 보이는 이름 (선택)</label>
    <input id="bm" value="${esc(b.bankMatch || '')}" placeholder="예: GA POWER" autocomplete="off">
    <p class="hint">은행 내역에 회사 이름이 다르게 찍히면 적어 주세요. 비우면 회사 이름으로 찾아요.</p>
    <button class="btn" type="submit">저장</button>
  </form>
  ${isNew ? '' : '<button class="btn danger" id="del">이 항목 그만 보기</button>'}
  <a class="btn ghost" href="#/">← 돌아가기</a>`;
  render(isNew ? '새 항목 등록' : '항목 고치기', html, 'home');

  document.getElementById('f').onsubmit = e => {
    e.preventDefault();
    const val = x => document.getElementById(x).value;
    const lo = val('lo'), hi = val('hi');
    Object.assign(b, { vendor: val('v').trim(), kind: val('k'), accountId: val('ac'), dueDay: Number(val('dd')),
      amountMin: lo === '' ? '' : Number(lo), amountMax: hi === '' ? '' : Number(hi), method: val('m'), bankMatch: val('bm').trim() });
    if (isNew) { b.id = uid(); b.active = true; b.since = thisMonth(); db.bills.push(b); }
    save(); go('#/');
  };
  const del = document.getElementById('del');
  // 지난 기록을 남기려고 지우지 않고 숨긴다
  if (del) del.onclick = () => { if (confirm(`${b.vendor} 항목을 목록에서 뺄까요? 지난 기록은 남아요.`)) { b.active = false; save(); go('#/'); } };
}

/* ---------- 화면 4: 지난 기록 ---------- */

// 아버님 피드백(11-18): 항목마다 달별 금액을 나란히, 한 달 합계도. 지난달과 많이 다르면 눈에 띄게만(판정은 사람이).
const paidAmount = (b, ym) => { const p = paymentFor(b.id, ym); return p && p.amount != null ? Number(p.amount) : null; };

function amountCell(b, ym) {
  if (b.since && b.since > ym) return '<td class="none">—</td>';
  const s = statusOf(b, ym);
  const link = inner => `<a href="#/check/${b.id}/${ym}">${inner}</a>`;
  if (s.key === 'wait') return `<td class="wait">${link('아직')}</td>`;
  if (s.key === 'missed') return `<td class="missed">${link('! 없음')}</td>`;
  const cur = paidAmount(b, ym);
  if (cur == null) return `<td>${link('✓')}</td>`;
  const c = L.change(paidAmount(b, addMonths(ym, -1)), cur);
  if (!c || !c.flag) return `<td>${link(`$${Math.round(cur)}`)}</td>`;
  const up = c.diff > 0;
  return `<td class="flag">${link(`$${Math.round(cur)}<small>${up ? '▲' : '▼'} ${Math.round(Math.abs(c.pct) * 100)}%</small>`)}</td>`;
}

function amountTableHtml(months) {
  const bills = activeBills().filter(b => !b.since || b.since <= months[months.length - 1]);
  const head = `<tr><th scope="col">항목</th>${months.map(m => `<th scope="col">${shortMonth(m)}</th>`).join('')}</tr>`;
  let body = '';
  for (const g of groupBills(bills)) {
    body += `<tr class="grp"><th colspan="${months.length + 1}" scope="rowgroup">${esc(g.title)}</th></tr>`;
    for (const b of g.items) body += `<tr><th scope="row">${esc(b.vendor)}</th>${months.map(m => amountCell(b, m)).join('')}</tr>`;
  }
  const totals = months.map(m => bills.reduce((sum, b) => sum + (paidAmount(b, m) || 0), 0));
  const foot = `<tr class="total"><th scope="row">합계</th>${totals.map(t => `<td>$${Math.round(t).toLocaleString('en-US')}</td>`).join('')}</tr>`;
  return `<div class="table-wrap"><table class="amounts"><caption class="sr-only">달별 나간 금액</caption>
    <thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function screenHistory() {
  const now = thisMonth();
  // 이번 달까지 최근 세 달을 나란히 (412px 폰 한 화면에 들어가는 칸 수)
  const months = [-2, -1, 0].map(n => addMonths(now, n)).filter(m => m >= firstMonth());
  const list = [];
  for (let ym = addMonths(now, -1); ym >= firstMonth(); ym = addMonths(ym, -1)) list.push(ym);

  let html = '';
  if (activeBills().length && months.length > 1) {
    html += groupSwitchHtml() + '<h2>달별 금액</h2>' + amountTableHtml(months);
    html += `<p class="hint">지난달보다 ${Math.round(L.CHANGE_PCT * 100)}% 넘게, $${L.CHANGE_USD} 넘게 달라진 금액은 노란 칸이에요.
      잘못 나간 건 아닌지 청구서와 맞춰 보세요. ${shortMonth(now)} 합계는 아직 안 나간 항목을 빼고 셌어요.</p>`;
  }
  html += '<h2>달마다 자세히</h2>';
  html += list.length ? '<p class="muted">달을 누르면 그 달 기록을 볼 수 있어요.</p>'
                      : '<p class="muted">아직 지난 기록이 없어요. 다음 달부터 여기에 쌓여요.</p>';
  for (const ym of list) {
    const c = { paid: 0, missed: 0 };
    billsIn(ym).forEach(b => { const k = statusOf(b, ym).key; if (k in c) c[k]++; });
    html += `<a class="bill ${c.missed ? 'missed' : ''}" href="#/month/${ym}">
      <div class="who"><b>${monthLabel(ym)}</b><span>나감 ${c.paid} · 안 나감 ${c.missed}</span></div>
      <span class="badge ${c.missed ? 's-missed' : 's-paid'}">${c.missed ? '! 확인 필요' : '✓ 모두 나감'}</span></a>`;
  }
  render('지난 기록', html, 'history');
  bindGroupSwitch(screenHistory);
}

/* ---------- 설정: 계좌 · 가족 한마디 · 백업 ---------- */

function screenSettings() {
  let html = sampleBanner();
  html += '<h2>계좌</h2><p class="hint">계좌번호 전체는 넣지 마세요. 끝 4자리만 있으면 충분해요.</p><ul class="list-plain">';
  for (const a of db.accounts) {
    const n = activeBills().filter(b => b.accountId === a.id).length;
    html += `<li><b>${esc(accountText(a))}</b> ${a.bank ? `· ${esc(a.bank)}` : ''}<br><span class="muted small">항목 ${n}개</span>
      ${n === 0 ? ` <button class="btn danger small-btn" data-del="${a.id}">지우기</button>` : ''}</li>`;
  }
  html += `</ul><form id="fa">
    <label for="an">계좌 별칭</label><input id="an" required placeholder="예: 생활비 통장">
    <div class="row"><div><label for="ab">은행</label><input id="ab" placeholder="예: Chase"></div>
    <div><label for="a4">끝 4자리</label><input id="a4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1234"></div></div>
    <button class="btn ghost" type="submit">+ 계좌 추가</button></form>

    ${bankSettingsHtml()}

    <h2>가족 한마디</h2><p class="hint">첫 화면 맨 위에 보여요. 자녀가 직접 써 주세요.</p>
    <form id="fn"><label for="nt">한마디</label>
    <textarea id="nt" rows="2" placeholder="예: 엄마, 빨간 표시 뜨면 저한테 전화 주세요">${esc(db.familyNote)}</textarea>
    <label for="nm">쓴 사람</label><input id="nm" value="${esc(db.familyName)}" placeholder="예: 지원">
    <button class="btn ghost" type="submit">한마디 저장</button></form>

    <h2>기다리는 날짜</h2>
    <label for="g">예정일이 지나고 며칠까지 "아직"으로 볼까요?</label>
    <select id="g">${[0, 1, 2, 3, 5, 7].map(n => `<option value="${n}" ${n === db.graceDays ? 'selected' : ''}>${n}일</option>`).join('')}</select>
    <p class="hint">은행에 따라 출금이 하루이틀 늦게 보일 수 있어서 기본은 3일이에요.</p>

    <h2>백업</h2>
    <p class="hint">자료는 이 기기에만 있어요. 휴대폰을 바꾸기 전에 꼭 백업 파일을 저장하세요.</p>
    <button class="btn ghost" id="exp">백업 파일 저장</button>
    <label class="btn ghost" for="imp" style="margin:12px 0">백업 파일 불러오기</label>
    <input id="imp" type="file" accept="application/json,.json" hidden>
    ${db.sample ? '<button class="btn danger" id="clear">샘플 지우고 처음부터 시작</button>' : ''}
    <p class="muted small" style="margin-top:24px">AI 사용 없음 · ${bank
      ? '은행 거래내역은 Plaid 를 거쳐 이 컴퓨터에만 저장'
      : '서버로 보내는 자료 없음'}</p>`;
  render('설정', html, 'settings');

  const $ = id => document.getElementById(id);
  $('fa').onsubmit = e => {
    e.preventDefault();
    db.accounts.push({ id: uid(), name: $('an').value.trim(), bank: $('ab').value.trim(), last4: $('a4').value.trim() });
    save(); screenSettings();
  };
  view.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    db.accounts = db.accounts.filter(a => a.id !== btn.dataset.del); save(); screenSettings();
  });
  const connect = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); bank = await api('/api/status'); screenSettings(); }
    catch (e) { btn.disabled = false; alert(`은행을 연결하지 못했어요: ${e.message}`); }
  };
  if ($('link')) $('link').onclick = () => connect($('link'), () => openPlaidLink());
  bindRelink(screenSettings);
  if ($('sbx')) $('sbx').onclick = () => connect($('sbx'), () => api('/api/sandbox-connect', {}));
  $('fn').onsubmit = e => { e.preventDefault(); db.familyNote = $('nt').value.trim(); db.familyName = $('nm').value.trim(); save(); alert('저장했어요.'); };
  $('g').onchange = () => { db.graceDays = Number($('g').value); save(); };
  $('exp').onclick = () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `silver-bills-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('imp').onchange = async () => {
    const file = $('imp').files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.bills) || !Array.isArray(data.accounts) || !Array.isArray(data.payments)) throw new Error('형식');
      if (!confirm('지금 자료를 백업 파일 내용으로 바꿀까요?')) return;
      db = Object.assign(emptyData(), data); save(); go('#/');
    } catch (e) { alert('이 파일은 불러올 수 없어요. 이 앱에서 저장한 백업 파일인지 확인해 주세요.'); }
  };
  if ($('clear')) $('clear').onclick = () => {
    if (!confirm('샘플 자료를 모두 지울까요?')) return;
    db = emptyData(); save(); screenSettings();
  };
}

/* ---------- 샘플 자료 (애틀랜타 근교 가정 예시) ---------- */

function sampleData() {
  const d = emptyData();
  d.sample = true;
  d.sampleVersion = SAMPLE_VERSION;
  d.familyNote = '엄마, 빨간 표시 뜨면 저한테 전화 주세요. 모르는 번호로 돈 내라는 전화는 끊으시고요!';
  d.familyName = '딸 지원';
  d.accounts = [
    { id: 'a1', name: '생활비 통장', bank: 'Chase', last4: '1234' },
    { id: 'a2', name: '연금 통장', bank: 'Bank of America', last4: '5678' },
    { id: 'a3', name: '카드', bank: 'Costco Citi', last4: '9012' },
  ];
  const since = addMonths(thisMonth(), -3);
  d.bills = [
    { id: 'b1', vendor: 'Georgia Power', kind: '전기', accountId: 'a1', dueDay: 5, amountMin: 90, amountMax: 180, method: 'auto', active: true, since },
    { id: 'b2', vendor: 'Gwinnett County Water', kind: '수도', accountId: 'a1', dueDay: 12, amountMin: 45, amountMax: 80, method: 'auto', active: true, since },
    { id: 'b3', vendor: 'Atlanta Gas Light', kind: '가스', accountId: 'a2', dueDay: 18, amountMin: 30, amountMax: 120, method: 'auto', active: true, since },
    { id: 'b4', vendor: 'Xfinity', kind: '인터넷', accountId: 'a3', dueDay: 8, amountMin: 70, amountMax: '', method: 'card', active: true, since },
    { id: 'b5', vendor: 'T-Mobile', kind: '휴대폰', accountId: 'a3', dueDay: 22, amountMin: 60, amountMax: '', method: 'card', active: true, since },
    { id: 'b6', vendor: 'State Farm', kind: '보험', accountId: 'a2', dueDay: 28, amountMin: 140, amountMax: '', method: 'auto', active: true, since },
  ];
  // '나감' 기록은 손으로 만들지 않고, Plaid 형식 가짜 거래를 실제 매칭 함수(L.matchMonth)에 통과시켜 만든다.
  const masks = { 'sample-acc-1234': '1234', 'sample-acc-5678': '5678', 'sample-acc-9012': '9012' };
  const txs = samplePlaidTransactions(d.bills).map(t => L.fromPlaid(t, masks));
  const used = new Set();
  for (let ym = since; ym <= thisMonth(); ym = addMonths(ym, 1)) {
    const matches = L.matchMonth(d.bills, ym, txs, {
      graceDays: d.graceDays, used,
      last4Of: id => d.accounts.find(a => a.id === id)?.last4 || '',
    });
    for (const { bill, tx } of matches) {
      d.payments.push({ billId: bill.id, month: ym, paidDate: tx.date, amount: tx.amount, txId: tx.id, auto: true,
        note: `은행 거래: ${tx.name}${tx.pending ? ' (처리 중)' : ''}` });
    }
  }
  return d;
}

// Plaid /transactions/sync 의 Transaction 과 같은 모양의 가짜 거래 (금액·이름은 지어낸 예시)
// 이번 달: Georgia Power 가 평소의 두 배 넘게 나감(눈에 띄어야 하는 예), 가스는 계절 따라 조금 오름(표시 안 됨).
// 지난달: T-Mobile 이 안 나감('안 나감' 예).
function samplePlaidTransactions(bills) {
  const m0 = thisMonth();
  const plan = { // 3달 전, 2달 전, 지난달, 이번 달
    b1: { name: 'GEORGIA POWER CO BILL PAY', merchant: 'Georgia Power', acc: 'sample-acc-1234', amt: [168.20, 142.55, 128.10, 311.40] },
    b2: { name: 'GWINNETT CNTY WATER RES', merchant: 'Gwinnett County', acc: 'sample-acc-1234', amt: [52.10, 58.40, 55.75, 61.30] },
    b3: { name: 'ATLANTA GAS LIGHT CO DEBIT', merchant: 'Atlanta Gas Light', acc: 'sample-acc-5678', amt: [34.20, 33.90, 41.80, 58.90] },
    b4: { name: 'COMCAST XFINITY 800-266-2278', merchant: 'Xfinity', acc: 'sample-acc-9012', amt: [70.00, 70.00, 70.00, 85.00] },
    b5: { name: 'T-MOBILE PCS SVC', merchant: 'T-Mobile', acc: 'sample-acc-9012', amt: [65.00, 65.00, null, 65.00] },
    b6: { name: 'STATE FARM RO 27 SFPP', merchant: 'State Farm', acc: 'sample-acc-5678', amt: [142.00, 142.00, 142.00, 142.00] },
  };
  const out = [];
  const tx = (id, acc, date, amount, name, merchant, category) => out.push({
    transaction_id: id, account_id: acc, amount, iso_currency_code: 'USD', date, authorized_date: date,
    name, merchant_name: merchant, pending: date >= addDays(today(), -1), payment_channel: 'other',
    personal_finance_category: { primary: category, detailed: `${category}_OTHER` },
  });
  [-3, -2, -1, 0].forEach((off, i) => {
    const ym = addMonths(m0, off);
    for (const b of bills) {
      const p = plan[b.id];
      const date = addDays(dueDate(b, ym), b.id === 'b3' ? 1 : 0); // 가스는 하루 늦게 찍히는 예
      if (!p || p.amt[i] == null || date > today()) continue;
      tx(`sample-${b.id}-${ym}`, p.acc, date, p.amt[i], p.name, p.merchant, b.kind === '보험' ? 'LOAN_PAYMENTS' : 'RENT_AND_UTILITIES');
    }
    // 공과금이 아닌 거래도 섞어 둔다 (매칭에서 빠져야 한다)
    const shop = `${ym}-10`;
    if (shop <= today()) tx(`sample-kroger-${ym}`, 'sample-acc-1234', shop, 86.43, 'KROGER #1234', 'Kroger', 'FOOD_AND_DRINK');
  });
  return out;
}

/* ---------- 은행 연결 (Plaid, 로컬 서버가 있을 때만) ---------- */
// GitHub Pages 처럼 서버가 없는 곳에서는 bank 가 null 이고 은행 관련 버튼이 보이지 않는다.

let bank = null;

async function api(pathname, body) {
  const res = await fetch(pathname, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `오류 ${res.status}`);
  return json;
}

async function loadBank() {
  if (location.protocol === 'file:' || location.hostname.endsWith('github.io')) return;
  try { bank = await api('/api/status'); } catch { bank = null; }
}
const bankReady = () => bank && bank.configured && bank.banks.length > 0;
const needsRelink = () => Boolean(bank && bank.relink && bank.relink.length);

// 은행 비밀번호를 바꾸면 Plaid 가 다시 로그인을 요구한다 → 큰 안내와 '다시 연결하기' 버튼
function relinkHtml() {
  if (!needsRelink()) return '';
  return bank.relink.map(r => `<div class="relink" role="alert">
    <p><b>${esc(r.institution)}</b> 연결이 잠시 끊겼어요.</p>
    <p class="small">은행 비밀번호를 바꾸셨거나 은행이 다시 확인을 원할 때 이래요. 돈이나 기록에는 문제가 없어요.</p>
    <button class="btn" data-relink="${esc(r.itemId)}">다시 연결하기</button></div>`).join('');
}
function bindRelink(after) {
  view.querySelectorAll('[data-relink]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true; btn.textContent = '연결 화면을 여는 중…';
    try { await openPlaidLink(btn.dataset.relink); bank = await api('/api/status'); after(); }
    catch (e) { btn.disabled = false; btn.textContent = '다시 연결하기'; alert(`다시 연결하지 못했어요: ${e.message}`); }
  });
}

const nameMatches = L.nameMatches;
const candidates = (bill, ym, txs) => L.candidates(bill, ym, txs, { graceDays: db.graceDays, last4: accountOf(bill.accountId)?.last4 || '' });

async function monthTransactions(ym) {
  const { transactions } = await api(`/api/transactions?from=${addDays(`${ym}-01`, -7)}&to=${addDays(`${ym}-${daysInMonth(ym)}`, 14)}`);
  return transactions;
}

// 은행 거래와 맞춰 '나감' 자동 체크. 이미 다른 항목에 쓴 거래는 다시 쓰지 않는다. (샘플 자료도 이 길을 지난다)
function applyMatches(ym, txs) {
  const matches = L.matchMonth(billsIn(ym), ym, txs, {
    graceDays: db.graceDays,
    last4Of: id => accountOf(id)?.last4 || '',
    isPaid: id => Boolean(paymentFor(id, ym)),
    used: new Set(db.payments.map(p => p.txId).filter(Boolean)),
  });
  for (const { bill, tx } of matches) {
    db.payments.push({ billId: bill.id, month: ym, paidDate: tx.date, amount: tx.amount, txId: tx.id, auto: true,
      note: `은행 거래: ${tx.name}${tx.pending ? ' (처리 중)' : ''}` });
  }
  return matches;
}

async function autoCheck(ym) {
  await api('/api/sync', {});
  const txs = await monthTransactions(ym);
  const marked = applyMatches(ym, txs).map(m => m.bill.vendor);
  save();
  bank = await api('/api/status');
  return marked;
}

// itemId 를 주면 끊긴 연결을 되살린다(Plaid update mode) — 새 연결이 아니라 같은 은행
function openPlaidLink(itemId) {
  return new Promise((resolve, reject) => {
    const start = async () => {
      try {
        const { link_token } = await api('/api/link-token', itemId ? { itemId } : {});
        window.Plaid.create({
          token: link_token,
          onSuccess: async public_token => {
            try { resolve(await (itemId ? api('/api/relinked', { itemId }) : api('/api/exchange', { public_token }))); }
            catch (e) { reject(e); }
          },
          onExit: err => err ? reject(new Error(err.display_message || err.error_message || '연결을 마치지 못했어요')) : resolve(null),
        }).open();
      } catch (e) { reject(e); }
    };
    if (window.Plaid) return start();
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = start;
    s.onerror = () => reject(new Error('Plaid 화면을 불러오지 못했어요'));
    document.head.appendChild(s);
  });
}

function bankSettingsHtml() {
  if (!bank) return '';
  let html = '<h2>은행 연결</h2>';
  if (!bank.configured) return html + '<p class="hint">서버에 Plaid 키가 아직 없어요. server/.env 를 채워 주세요.</p>';
  if (bank.env === 'sandbox') html += '<p class="sample-banner">지금은 Plaid 시험용(가짜 은행) 모드예요.</p>';
  html += relinkHtml();
  if (bank.accounts.length) {
    html += '<ul class="list-plain">' + bank.accounts.map(a =>
      `<li><b>${esc(a.institution || '은행')}</b> · ${esc(a.name)}${a.mask ? ` (끝 ${esc(a.mask)})` : ''}</li>`).join('') + '</ul>';
    html += `<p class="hint">마지막으로 가져온 때: ${bank.syncedAt ? esc(new Date(bank.syncedAt).toLocaleString('ko-KR')) : '아직 없음'}</p>`;
  } else html += '<p class="hint">연결된 은행이 없어요.</p>';
  html += '<button class="btn ghost" id="link">+ 은행 연결하기</button>';
  if (bank.env === 'sandbox') html += '<button class="btn ghost" id="sbx">시험 은행 바로 연결</button>';
  html += '<p class="hint">은행 로그인은 Plaid 화면에서 하고, 이 앱은 비밀번호를 보지 않아요. 거래내역은 이 컴퓨터에만 저장돼요.</p>';
  return html;
}

/* ---------- 길 찾기 ---------- */

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const ymOk = s => /^\d{4}-\d{2}$/.test(s || '');
  switch (parts[0]) {
    case 'month': return ymOk(parts[1]) && parts[1] <= thisMonth() ? screenMonth(parts[1]) : screenMonth(thisMonth());
    case 'check': return screenCheck(parts[1], ymOk(parts[2]) ? parts[2] : thisMonth());
    case 'bill': return screenBill(parts[1] || 'new');
    case 'history': return screenHistory();
    case 'settings': return screenSettings();
    default: return screenMonth(thisMonth());
  }
}

db = load();
if (db.sample) save();
window.addEventListener('hashchange', route);
loadBank().then(route);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
