/* FamilyQuest — Firebase Cloud Messaging service worker.
 *
 * SCOPE: /firebase-messaging/
 *
 * This worker is deliberately separate from the main PWA service worker,
 * which controls "/". This prevents the workers from clobbering each other.
 *
 * SECURITY:
 * This file contains only Firebase's public web configuration. Never place
 * Firebase Admin credentials, service-account data or private server keys here.
 *
 * IMPORTANT:
 * The backend sends an FCM notification payload. FCM displays that notification
 * automatically while the app is in the background. Do not call
 * self.registration.showNotification() here, otherwise the same push can appear
 * twice.
 */

importScripts(
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js',
);

const firebaseConfig = {
  apiKey: 'AIzaSyBtV5vUHSGebsqs5Rvw_dftkNNeDhFuiLU',
  authDomain: 'familyquest-beta-402cb.firebaseapp.com',
  projectId: 'familyquest-beta-402cb',
  storageBucket: 'familyquest-beta-402cb.firebasestorage.app',
  messagingSenderId: '883349088062',
  appId: '1:883349088062:web:db417949c549c313e6ae6f',
};

firebase.initializeApp(firebaseConfig);

/*
 * Default icon and badge used for FamilyQuest notifications. The Cloud Function
 * already sets these in the FCM webpush payload (see functions/src/pushDelivery.ts),
 * but we keep a single source of truth here so any notification handled by this
 * worker falls back to the correct branded assets.
 */
const NOTIFICATION_ICON = '/pwa-192x192.png';
const NOTIFICATION_BADGE = '/pwa-192x192.png';

/*
 * Initialising Messaging enables this service worker to receive FCM messages.
 *
 * There is intentionally no onBackgroundMessage handler and no manual
 * showNotification() call. The notification payload sent by the Cloud Function
 * is displayed automatically by FCM.
 */
firebase.messaging();

/*
 * Handle clicks on notifications received by this worker.
 *
 * Prefer an existing FamilyQuest window. When one exists, focus it and navigate
 * to the route stored in notification data. Otherwise open a new window.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const requestedRoute =
    typeof notificationData.route === 'string' &&
    notificationData.route.startsWith('/')
      ? notificationData.route
      : '/';

  const targetUrl = new URL(requestedRoute, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then(async (windowClients) => {
        for (const client of windowClients) {
          const clientUrl = new URL(client.url);

          if (
            clientUrl.origin === self.location.origin &&
            typeof client.focus === 'function'
          ) {
            await client.focus();

            if (typeof client.navigate === 'function') {
              await client.navigate(targetUrl);
            }

            return;
          }
        }

        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      }),
  );
});
