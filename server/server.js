'use strict';
/*
 * Plaid 연동 로컬 서버 — 외부 패키지 없음 (Node 22+)
 * - app/ 정적 파일을 같은 주소로 제공하고, /api/* 로 Plaid 를 부른다.
 * - Plaid 비밀키와 은행 접근 토큰은 이 PC 에만 있다: 키는 server/.env, 토큰은 server/.data/ (둘 다 git 제외).
 * - 접근 토큰은 TOKEN_KEY 로 AES-256-GCM 암호화해서 저장한다.
 * 실행: node server/server.js  →  http://localhost:8787
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'app');
const DATA_DIR = path.join(__dirname, '.data');
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT || 8787);
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';
const PLAID_HOST = { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' }[PLAID_ENV];
const CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const SECRET = process.env.PLAID_SECRET || '';
const TOKEN_KEY = process.env.TOKEN_KEY ? Buffer.from(process.env.TOKEN_KEY, 'hex') : null;
const configured = Boolean(PLAID_HOST && CLIENT_ID && SECRET && TOKEN_KEY && TOKEN_KEY.length === 32);

/* ---------- 저장 (이 PC 안) ---------- */

fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE = path.join(DATA_DIR, `store-${PLAID_ENV}.json`);
// items: [{ itemId, institution, token(암호문), cursor }], accounts: {account_id: {name, mask, itemId}}, tx: {transaction_id: {...}}
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { items: [], accounts: {}, tx: {} }; }
}
function writeStore(s) { fs.writeFileSync(STORE, JSON.stringify(s, null, 1)); }

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', TOKEN_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/* ---------- Plaid 호출 ---------- */

async function plaid(endpoint, body) {
  const res = await fetch(PLAID_HOST + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error_message || `Plaid ${endpoint} ${res.status}`);
    err.code = json.error_code;
    throw err;
  }
  return json;
}

async function saveItem(publicToken) {
  const { access_token, item_id } = await plaid('/item/public_token/exchange', { public_token: publicToken });
  const s = readStore();
  let institution = '';
  try {
    const { item } = await plaid('/item/get', { access_token });
    if (item.institution_id) {
      const { institution: ins } = await plaid('/institutions/get_by_id', { institution_id: item.institution_id, country_codes: ['US'] });
      institution = ins.name;
    }
  } catch { /* 은행 이름은 없어도 된다 */ }
  s.items = s.items.filter(i => i.itemId !== item_id);
  s.items.push({ itemId: item_id, institution, token: encrypt(access_token), cursor: null });
  writeStore(s);
  return { itemId: item_id, institution };
}

// /transactions/sync 로 바뀐 거래만 받아온다 (cursor 이어받기)
async function syncAll() {
  const s = readStore();
  let added = 0;
  for (const item of s.items) {
    const access_token = decrypt(item.token);
    let more = true;
    while (more) {
      const r = await plaid('/transactions/sync', { access_token, cursor: item.cursor || undefined, count: 500 });
      for (const a of r.accounts || []) s.accounts[a.account_id] = { name: a.name, mask: a.mask, itemId: item.itemId, institution: item.institution };
      for (const t of [...r.added, ...r.modified]) {
        if (!s.tx[t.transaction_id]) added++;
        // 화면에 필요한 것만 남긴다
        s.tx[t.transaction_id] = {
          id: t.transaction_id, accountId: t.account_id, date: t.date, amount: t.amount,
          name: t.name, merchant: t.merchant_name || '', pending: t.pending,
        };
      }
      for (const t of r.removed) delete s.tx[t.transaction_id];
      item.cursor = r.next_cursor;
      more = r.has_more;
    }
  }
  s.syncedAt = new Date().toISOString();
  writeStore(s);
  return { added, syncedAt: s.syncedAt };
}

function listTransactions(from, to) {
  const s = readStore();
  return Object.values(s.tx)
    .filter(t => t.date >= from && t.date <= to)
    .map(t => ({ ...t, mask: s.accounts[t.accountId]?.mask || '', accountName: s.accounts[t.accountId]?.name || '' }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- HTTP ---------- */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e5) throw new Error('too large'); }
  return raw ? JSON.parse(raw) : {};
}

const routes = {
  'GET /api/status': () => {
    const s = readStore();
    return { configured, env: PLAID_ENV, banks: s.items.map(i => i.institution || '은행'),
      accounts: Object.values(s.accounts).map(a => ({ name: a.name, mask: a.mask, institution: a.institution })), syncedAt: s.syncedAt || null };
  },
  'POST /api/link-token': async () => {
    const r = await plaid('/link/token/create', {
      user: { client_user_id: 'silver-local-user' }, client_name: '공과금 확인',
      products: ['transactions'], transactions: { days_requested: 180 }, country_codes: ['US'], language: 'en',
    });
    return { link_token: r.link_token };
  },
  'POST /api/exchange': async body => saveItem(String(body.public_token || '')),
  'POST /api/sync': () => syncAll(),
  'GET /api/transactions': (_, url) => {
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('from/to 가 필요해요');
    return { transactions: listTransactions(from, to) };
  },
  // 시험용(sandbox)에서만: Plaid 가짜 은행을 화면 없이 연결한다
  'POST /api/sandbox-connect': async () => {
    if (PLAID_ENV !== 'sandbox') throw new Error('sandbox 전용');
    const r = await plaid('/sandbox/public_token/create', { institution_id: 'ins_109508', initial_products: ['transactions'] });
    return saveItem(r.public_token);
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    // 다른 사이트가 이 PC 의 서버를 부르지 못하게 같은 주소에서 온 요청만 받는다
    const origin = req.headers.origin;
    if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) return send(res, 403, { error: 'forbidden' });
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not found' });
    if (url.pathname !== '/api/status' && !configured) return send(res, 503, { error: 'server/.env 에 Plaid 키가 없어요' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      return send(res, 200, await handler(body, url));
    } catch (e) {
      console.error(url.pathname, e.code || '', e.message);
      return send(res, 500, { error: e.message, code: e.code || null });
    }
  }
  // 정적 파일
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// 이 PC 안에서만 열리게 127.0.0.1 에만 묶는다
server.listen(PORT, '127.0.0.1', () => {
  console.log(`공과금 확인 서버: http://localhost:${PORT}  (Plaid ${PLAID_ENV}${configured ? '' : ' — 키 없음, server/.env 확인'})`);
});
