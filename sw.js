// Service worker mínimo para Web Push (punto 12). Servido como archivo estático en /sw.js
// (fuera de _routes.json, que solo enruta /api/* a Functions), con alcance de todo el origen.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  let payload = { title: 'ALGORITHM', body: 'Cambio de estado en tu alerta.', url: '/' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch (error) { /* payload no-JSON, se usa el default */ }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsList => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
