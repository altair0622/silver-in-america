// 오프라인에서도 열리도록 앱 파일만 캐시한다. 파일을 바꾸면 VERSION 을 올린다.
const VERSION = 'v5';
const FILES = ['./', 'index.html', 'style.css', 'logic.js', 'app.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 네트워크 먼저, 안 되면 캐시 — 고친 내용이 바로 보이게
self.addEventListener('fetch', e => {
  // /api 는 은행 자료라 캐시하지 않는다. 다른 주소(Plaid 화면 등)는 건드리지 않는다.
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
