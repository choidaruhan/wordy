/**
 * 이 앱은 서비스 워커를 쓰지 않는다.
 * 예전 버전의 캐시가 남아 있으면 새 화면이 안 보일 수 있으므로,
 * 기존 워커는 캐시를 지우고 스스로 등록 해제한다.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
