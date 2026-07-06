/**
 * fleet-ui service worker — Web Push receiver for fleet approval gates.
 *
 * The daemon (lib/fleet/push-notifications.ts) sends payloads shaped as:
 *   { title, body, tag, deepLink, data? }
 *
 * `tag` groups notifications (ten pending approvals collapse into one
 * refreshed banner instead of a pile). `notificationclick` focuses an
 * existing fleet-ui window (navigating it to the deep link) or opens one.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Port Daddy', body: '', tag: 'fleet', deepLink: '/fleet-ui/' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // Malformed push: show the generic banner rather than nothing.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,          // grouping: same-tag replaces, no pile-up
      renotify: true,            // ...but still alert on each new gate
      data: { deepLink: payload.deepLink, ...(payload.data || {}) },
      icon: '/fleet-ui/favicon.svg',
      badge: '/fleet-ui/favicon.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = (event.notification.data && event.notification.data.deepLink) || '/fleet-ui/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes('/fleet-ui/') && 'focus' in client) {
          client.navigate(deepLink);
          return client.focus();
        }
      }
      return self.clients.openWindow(deepLink);
    }),
  );
});
