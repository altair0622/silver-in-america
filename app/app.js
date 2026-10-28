'use strict';
/*
 * 공과금 확인 — 1단계 (서버 없음, AI 없음)
 * 데이터는 이 기기의 localStorage 에만 저장한다. 계좌번호 전체·카드번호는 저장하지 않는다(끝 4자리만).
 * 화면: #/ 이번 달 · #/month/YYYY-MM · #/check/<billId>/<YYYY-MM> · #/bill/<id|new> · #/history · #/settings
 */

const STORE_KEY = 'silver-bills-v1';

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
  return { version: 1, sample: false, graceDays: 3, familyNote: '', familyName: '', accounts: [], bills: [], payments: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(emptyData(), JSON.parse(raw));
  } catch (e) { /* 읽지 못하면 샘플로 시작 */ }
  return sampleData();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { alert('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); }
}

let db; // 날짜 함수가 정의된 뒤 아래 '길 찾기'에서 불러온다

/* ---------- 날짜 ---------- */

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisMonth = () => today().slice(0, 7);

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
function monthLabel(ym) { const [y, m] = ym.split('-'); return `${y}년 ${Number(m)}월`; }
function dayLabel(date) { const [, m, d] = date.split('-'); return `${Number(m)}월 ${Number(d)}일`; }

/* ---------- 상태 계산 ---------- */

function paymentFor(billId, ym) { return db.payments.find(p => p.billId === billId && p.month === ym); }

// 상태는 세 가지만: paid(나감) / wait(아직) / missed(안 나감)
function statusOf(bill, ym) {
  const p = paymentFor(bill.id, ym);
  if (p) return { key: 'paid', label: '✓ 나감', payment: p };
  const due = dueDate(bill, ym);
  const deadline = addDays(due, db.graceDays);
  const now = today();
  if (now < due) return { key: 'wait', label: '⏳ 아직', detail: `${dayLabel(due)} 예정` };
  if (now <= deadline) return { key: 'wait', label: '⏳ 아직', detail: `${dayLabel(due)} 예정 · ${dayLabel(deadline)}까지 기다려 봐요` };
  return { key: 'missed', label: '⚠ 안 나감', detail: `${dayLabel(due)} 예정이었어요` };
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
  const rows = bills.map(b => { const s = statusOf(b, ym); counts[s.key]++; return { b, s }; });

  // 계좌별로 묶는다. 예정일 순.
  const groups = db.accounts.map(a => ({ a, items: rows.filter(r => r.b.accountId === a.id) }));
  const orphan = rows.filter(r => !accountOf(r.b.accountId));
  if (orphan.length) groups.push({ a: null, items: orphan });

  let html = familyNoteHtml() + sampleBanner();
  html += `<div class="month-nav">
    ${ym > firstMonth() ? `<a class="btn ghost small-btn" href="#/month/${addMonths(ym, -1)}">◀ 이전</a>` : '<span style="width:80px"></span>'}
    <strong>${monthLabel(ym)}</strong>
    ${isNow ? '<span style="width:80px"></span>' : `<a class="btn ghost small-btn" href="#/month/${addMonths(ym, 1)}">다음 ▶</a>`}
  </div>`;
  html += `<div class="summary">
    <span class="s-paid">✓ 나감 ${counts.paid}</span>
    <span class="s-wait">⏳ 아직 ${counts.wait}</span>
    <span class="s-missed">⚠ 안 나감 ${counts.missed}</span>
  </div>`;
  if (counts.missed) html += `<p><b style="color:var(--bad)">확인이 필요한 항목이 ${counts.missed}개 있어요.</b> 눌러서 이유를 보세요.</p>`;
  else if (bills.length && counts.wait === 0) html += '<p><b style="color:var(--ok)">이번 달 모두 나갔어요.</b></p>';

  for (const g of groups) {
    if (!g.items.length) continue;
    html += `<h3>${esc(accountText(g.a))}${g.a?.bank ? ` · ${esc(g.a.bank)}` : ''}</h3>`;
    g.items.sort((x, y) => x.b.dueDay - y.b.dueDay);
    for (const { b, s } of g.items) {
      const sub = s.key === 'paid'
        ? `${dayLabel(s.payment.paidDate)} 나감${s.payment.amount != null ? ` · $${s.payment.amount}` : ''}`
        : s.detail;
      html += `<a class="bill ${s.key === 'missed' ? 'missed' : ''}" href="#/check/${b.id}/${ym}">
        <div class="who"><b>${esc(b.vendor)}</b><span>${esc(b.kind)} · ${esc(sub)}</span></div>
        <span class="badge s-${s.key}">${s.label}</span></a>`;
    }
  }
  if (!bills.length) html += `<p class="muted">${isNow ? '아직 등록한 항목이 없어요.' : '이 달에는 기록한 항목이 없어요.'}</p>`;
  html += '<a class="btn ghost" href="#/bill/new">+ 새 항목 등록</a>';
  html += `<div class="scam"><b>잠깐!</b> "전기가 곧 끊긴다, 기프트카드로 지금 내라"는 전화는 <b>사기</b>예요.
    전화를 끊고 이 화면에서 "나감"인지 먼저 확인하세요. 진짜 회사는 기프트카드를 요구하지 않아요.</div>`;
  render(isNow ? '이번 달 한눈에' : monthLabel(ym), html, isNow ? 'home' : 'history');
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
      ${p.amount != null ? `<p>금액: $${p.amount}</p>` : ''}
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
      amountMin: lo === '' ? '' : Number(lo), amountMax: hi === '' ? '' : Number(hi), method: val('m') });
    if (isNew) { b.id = uid(); b.active = true; b.since = thisMonth(); db.bills.push(b); }
    save(); go('#/');
  };
  const del = document.getElementById('del');
  // 지난 기록을 남기려고 지우지 않고 숨긴다
  if (del) del.onclick = () => { if (confirm(`${b.vendor} 항목을 목록에서 뺄까요? 지난 기록은 남아요.`)) { b.active = false; save(); go('#/'); } };
}

/* ---------- 화면 4: 지난 기록 ---------- */

function screenHistory() {
  const list = [];
  for (let ym = addMonths(thisMonth(), -1); ym >= firstMonth(); ym = addMonths(ym, -1)) list.push(ym);
  let html = list.length ? '<p class="muted">달을 누르면 그 달 기록을 볼 수 있어요.</p>'
                         : '<p class="muted">아직 지난 기록이 없어요. 다음 달부터 여기에 쌓여요.</p>';
  for (const ym of list) {
    const c = { paid: 0, missed: 0 };
    billsIn(ym).forEach(b => { const k = statusOf(b, ym).key; if (k in c) c[k]++; });
    html += `<a class="bill ${c.missed ? 'missed' : ''}" href="#/month/${ym}">
      <div class="who"><b>${monthLabel(ym)}</b><span>나감 ${c.paid} · 안 나감 ${c.missed}</span></div>
      <span class="badge ${c.missed ? 's-missed' : 's-paid'}">${c.missed ? '⚠ 확인 필요' : '✓ 모두 나감'}</span></a>`;
  }
  render('지난 기록', html, 'history');
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
    <p class="muted small" style="margin-top:24px">1단계 · AI 사용 없음 · 서버로 보내는 자료 없음</p>`;
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
  d.familyNote = '엄마, 빨간 표시 뜨면 저한테 전화 주세요. 모르는 번호로 돈 내라는 전화는 끊으시고요!';
  d.familyName = '딸 지원';
  d.accounts = [
    { id: 'a1', name: '생활비 통장', bank: 'Chase', last4: '1234' },
    { id: 'a2', name: '연금 통장', bank: 'Bank of America', last4: '5678' },
    { id: 'a3', name: '카드', bank: 'Costco Citi', last4: '9012' },
  ];
  const since = addMonths(thisMonth(), -2);
  d.bills = [
    { id: 'b1', vendor: 'Georgia Power', kind: '전기', accountId: 'a1', dueDay: 5, amountMin: 90, amountMax: 180, method: 'auto', active: true, since },
    { id: 'b2', vendor: 'Gwinnett County Water', kind: '수도', accountId: 'a1', dueDay: 12, amountMin: 45, amountMax: 80, method: 'auto', active: true, since },
    { id: 'b3', vendor: 'Atlanta Gas Light', kind: '가스', accountId: 'a2', dueDay: 18, amountMin: 30, amountMax: 120, method: 'auto', active: true, since },
    { id: 'b4', vendor: 'Xfinity', kind: '인터넷', accountId: 'a3', dueDay: 8, amountMin: 70, amountMax: '', method: 'card', active: true, since },
    { id: 'b5', vendor: 'T-Mobile', kind: '휴대폰', accountId: 'a3', dueDay: 22, amountMin: 60, amountMax: '', method: 'card', active: true, since },
    { id: 'b6', vendor: 'State Farm', kind: '보험', accountId: 'a2', dueDay: 28, amountMin: 140, amountMax: '', method: 'auto', active: true, since },
  ];
  // 지난 두 달은 모두 나감, 이번 달은 일부만 확인된 상태로 만든다 (T-Mobile 은 '안 나감' 예시)
  const m0 = thisMonth();
  for (const ym of [addMonths(m0, -2), addMonths(m0, -1)]) {
    for (const b of d.bills) d.payments.push({ billId: b.id, month: ym, paidDate: dueDate(b, ym), amount: b.amountMin, note: '' });
  }
  for (const id of ['b1', 'b2', 'b4']) {
    const b = d.bills.find(x => x.id === id);
    if (dueDate(b, m0) <= today()) d.payments.push({ billId: id, month: m0, paidDate: dueDate(b, m0), amount: b.amountMin + 12, note: '' });
  }
  return d;
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
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
