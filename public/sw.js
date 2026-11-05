/* Wordy service worker — 앱 셸만 캐시한다. HTML은 절대 캐시하지 않는다. */
const VERSION = 'wordy-v9';

const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/styles.css?v=9',
  '/htmx.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 화면 이동: 네트워크 우선. 실패하면 오프라인 안내.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // 정적 자산: 캐시 먼저 보여주고 뒤에서 갱신
  if (
    url.pathname === '/styles.css' ||
    url.pathname === '/htmx.min.js' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/')
  ) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => hit);

        return hit || network;
      })
    );
  }
});
