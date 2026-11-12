// Offline support: app shell cached; data is network-first (falls back to last copy).
const SHELL = 'tickmark-shell-v2';
const DATA = 'tickmark-data-v2';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'market.js', 'indicators.js', 'manifest.webmanifest', 'icons/icon.svg',
  'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(DATA).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request)));
});
