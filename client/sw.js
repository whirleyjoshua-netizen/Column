// Kloomie's service worker: shows pushes while the app is closed, and opens the app where a tapped one points.
// It doesn't cache anything; the app always loads fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Kloomie', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Kloomie', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-128.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/' },
    });
    if (typeof d.count === 'number' && self.navigator.setAppBadge) {
      try { d.count ? await self.navigator.setAppBadge(d.count) : await self.navigator.clearAppBadge(); } catch {}
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin);
  const go = url.searchParams.get('go');
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      if (go) win.postMessage({ type: 'go', go });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
