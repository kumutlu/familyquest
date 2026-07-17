/* FamilyQuest — Firebase Cloud Messaging service worker.
 *
 * SCOPE: /firebase-messaging/  (deliberately separate from the PWA service
 * worker which controls "/"). This prevents the two workers from clobbering
 * each other and keeps existing PWA behaviour intact.
 *
 * SECURITY: This file contains ONLY the public web config (the same values
 * shipped to the browser in the main app bundle). It must never contain the
 * Firebase Admin credential, private server keys, or any service-account data.
 *
 * The public config below mirrors src/lib/firebase.ts and the VITE_FIREBASE_*
 * values in .env. Keep them in sync when the web config changes.
 */
importScripts(

  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js',

  'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js'

);

const firebaseConfig = {
  apiKey: 'AIzaSyBtV5vUHSGebsqs5Rvw_dftkNNeDhFuiLU',
  authDomain: 'familyquest-beta-402cb.firebaseapp.com',
  projectId: 'familyquest-beta-402cb',
  storageBucket: 'familyquest-beta-402cb.firebasestorage.app',
  messagingSenderId: '883349088062',
  appId: '1:883349088062:web:db417949c549c313e6ae6f'
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Background message: show a notification. The deterministic tag (notification
// id / dedupe key) collapses retries into a single browser card.
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'FamilyQuest';
  const body = notification.body || data.body || '';
  const tag = notification.tag || data.notificationId || undefined;
  const route = data.route || '/';
  const notificationId = data.notificationId || '';
  const icon = notification.icon || '/pwa-192x192.png';
  const badge = notification.badge || '/pwa-192x192.png';

  return self.registration.showNotification(title, {
    body,
    tag,
    data: { route, notificationId },
    icon,
    badge,
    // Re-notify only when it is genuinely a new event.
    renotify: false
  });
});

// Click: focus an existing FamilyQuest window if present, otherwise open the
// correct route. Avoids spawning duplicate tabs.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.route) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
