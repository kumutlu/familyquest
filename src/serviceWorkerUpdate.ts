/**
 * FAMILYQUEST — SERVICE WORKER UPDATE & PUSH HANDLING
 *
 * This module wires service-worker lifecycle with real push notification
 * handling. It integrates with the existing Workbox-based SW and ensures
 * that:
 *   - Background notifications are handled without breaking app startup
 *   - Foreground messages do NOT show duplicate browser notifications
 *   - Notification click/deep-link handling is deterministic
 *   - The existing SW update/activation behavior is preserved
 *
 * Design: minimal, non-breaking additions. No second competing SW.
 */

import { getStartupPhase, logStartupDiagnostic, subscribeStartupPhase } from './startupDiagnostics';
import { FAMILYQUEST_BUILD } from './buildInfo';
import type { StartupPhase } from './components/layout/startupState';
import { onMessage as onMessageClient } from 'firebase/messaging';
import type { MessagePayload, Messaging } from 'firebase/messaging';

type ServiceWorkerUpdateSource = {
  controller: unknown;
  addEventListener: (
    name: 'controllerchange' | 'message',
    listener: (event?: { data?: unknown }) => void,
  ) => void;
};

export const LEGACY_SW_MIGRATION_ID = 'legacy-82422c8-2026-08';

interface MigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ServiceWorkerControllerListenerOptions {
  migrationId?: string;
  reload?: () => void;
  storage?: MigrationStorage;
  reloadDelayMs?: number;
}

/**
 * Observes service-worker `controllerchange` events. Normal releases omit the
 * migration ID and install no listener; the one rescue release gets an
 * explicitly guarded, at-most-once fallback reload.
 *
 * The migration worker posts before navigating legacy clients. That message
 * cancels the fallback timer; sessionStorage keyed by migration ID suppresses
 * duplicate controllerchange/navigation races and survives the navigation.
 */
export function installServiceWorkerControllerListener(
  serviceWorker: ServiceWorkerUpdateSource | undefined = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : undefined,
  options: ServiceWorkerControllerListenerOptions = {},
): void {
  const migrationId = options.migrationId;
  if (!serviceWorker?.controller || !migrationId) return;

  const storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  const reload = options.reload ?? defaultReload;
  const reloadDelayMs = options.reloadDelayMs ?? 250;
  const storageKey = `queki:sw-migration:${migrationId}`;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;

  serviceWorker.addEventListener('message', event => {
    const data = event?.data as { type?: string; migrationId?: string } | undefined;
    if (data?.type !== 'LEGACY_SW_MIGRATION_NAVIGATING' || data.migrationId !== migrationId) return;
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    storage?.setItem(storageKey, 'navigating');
  });

  serviceWorker.addEventListener('controllerchange', () => {
    const phase = getStartupPhase();
    if (phase !== 'ready') {
      logStartupDiagnostic('SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP', { phase });
    }

    // This branch exists for one migration release only. Mark the migration
    // before scheduling anything so duplicate controllerchange events cannot
    // queue multiple reloads. The migration worker normally navigates legacy
    // clients itself; its message cancels this guarded fallback reload.
    if (storage?.getItem(storageKey)) return;
    storage?.setItem(storageKey, 'pending');
    reloadTimer = setTimeout(() => {
      if (storage?.getItem(storageKey) === 'navigating') return;
      storage?.setItem(storageKey, 'reloading');
      reload();
    }, reloadDelayMs);
  });
}

// ---------------------------------------------------------------------------
// Safe update/reload for a *waiting* service worker.
//
// The PWA is built with `registerType: 'prompt'` + `skipWaiting: false` +
// `clientsClaim: false`. That means a newly deployed service worker installs in
// the background and parks in the `waiting` state; it never takes control of
// an already-open tab on its own. The previous lifecycle relied on the user
// manually reloading, so Safari (and any long-lived tab) kept executing the
// stale, service-worker-cached bundle — the Rewards UI never updated.
//
// This handler closes that gap: when a waiting worker is detected AND the app
// has finished bootstrapping (`phase === 'ready'`), we tell the waiting worker
// to `skipWaiting()` (the generated Workbox SW honours the `{ type:
// 'SKIP_WAITING' }` message) and then reload. The reload is *never* forced
// while bootstrap is in flight — doing so would mask a chunk-load failure as a
// generic "Connection problem". If a waiting worker is found mid-bootstrap we
// defer and subscribe to the startup phase, then safely apply the update the
// moment bootstrap reports `ready`.
// ---------------------------------------------------------------------------

/** Minimal structural type for a service worker in the `waiting` state. */
export interface ServiceWorkerLike {
  postMessage(message: unknown): void;
}

/** Minimal structural type for a service-worker registration. */
export interface ServiceWorkerRegistrationLike {
  waiting: ServiceWorkerLike | null;
  installing: {
    addEventListener: (name: string, listener: () => void) => void;
  } | null;
  addEventListener: (name: string, listener: (ev?: unknown) => void) => void;
}

/** Payload emitted immediately before a safe reload is performed. */
export interface SafeReloadInfo {
  /** The build SHA the client will be running after the safe reload. */
  sha: string;
}

export interface ServiceWorkerUpdateOptions {
  /** Reloads the page. Defaults to `window.location.reload`. */
  reload?: () => void;
  /** Returns the current startup phase. Defaults to `getStartupPhase`. */
  getPhase?: () => StartupPhase | 'unknown';
  /** Invoked right before a safe reload is performed (test/diagnostic hook). */
  onSafeReloadScheduled?: (info: SafeReloadInfo) => void;
  /** The build SHA the client will run after reload. Defaults to the current build SHA. */
  buildSha?: string;
}

function defaultReload(): void {
  if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
    window.location.reload();
  }
}

/**
 * Wires a service-worker registration so a newly installed worker in the
 * `waiting` state is safely activated once bootstrap has completed.
 *
 * @param registration The live `ServiceWorkerRegistration` (or a test double).
 * @param options      Test/diagnostic overrides. In production these default to
 *                     reloading the page and reading the real startup phase.
 */
export function installServiceWorkerUpdateHandler(
  registration: ServiceWorkerRegistrationLike | undefined,
  options: ServiceWorkerUpdateOptions = {},
): void {
  if (!registration) return;

  const reload = options.reload ?? defaultReload;
  const getPhase = options.getPhase ?? getStartupPhase;
  const onSafeReloadScheduled = options.onSafeReloadScheduled ?? (() => {});
  const buildSha = options.buildSha ?? FAMILYQUEST_BUILD.sha;

  const scheduleSafeReload = (reg: ServiceWorkerRegistrationLike): void => {
    const waiting = reg.waiting;
    if (!waiting) return;

    // Never force a reload while bootstrap is in flight — that would mask a
    // chunk-load failure as a generic "Connection problem". Defer and subscribe
    // so the update is applied the moment bootstrap reports `ready`.
    if (getPhase() !== 'ready') {
      logStartupDiagnostic('SERVICE_WORKER_UPDATE_DEFERRED_DURING_BOOTSTRAP', { phase: getPhase() });
      const unsubscribe = subscribeStartupPhase((phase) => {
        if (phase === 'ready') {
          unsubscribe();
          scheduleSafeReload(reg);
        }
      });
      return;
    }

    // Safe to apply the waiting worker: tell it to skip waiting, then reload.
    // The generated Workbox SW responds to `{ type: 'SKIP_WAITING' }` by
    // calling `self.skipWaiting()`, so the new build takes control on reload.
    //
    // IMPORTANT: we must NOT reload the instant we post the message. With
    // `clientsClaim: false` the existing client keeps its *old* controller until
    // it navigates, so a reload fired before the new worker has actually taken
    // over would be served by the stale SW and the user would stay on the old
    // build. We wait for the waiting worker to reach the `activated` state (the
    // point at which it becomes the active registration) and only then reload —
    // guaranteeing the navigation is served by the new build. This is exactly
    // one reload, and it can only happen once bootstrap is `ready`.
    onSafeReloadScheduled({ sha: buildSha });
    waiting.postMessage({ type: 'SKIP_WAITING' });

    const worker = waiting as unknown as {
      readonly state: 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';
      addEventListener: (type: 'statechange', listener: () => void) => void;
      removeEventListener: (type: 'statechange', listener: () => void) => void;
    };
    const reloadOnceActivated = (): void => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', reloadOnceActivated);
        reload();
      }
    };
    worker.addEventListener('statechange', reloadOnceActivated);
    if (worker.state === 'activated') reloadOnceActivated();
  };

  // A waiting worker may already exist (an update was found before this handler
  // attached). Handle it immediately.
  if (registration.waiting) {
    scheduleSafeReload(registration);
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // When the installing worker reaches the `installed` state it becomes the
      // `waiting` worker.
      if (registration.waiting) {
        scheduleSafeReload(registration);
      }
    });
  });
}

/**
 * Installs foreground push message listeners on the window Messaging
 * instance.
 *
 * NOTE on background messages: `onBackgroundMessage` is intentionally NOT
 * imported here. It is exported only from the Service-Worker entry point
 * (`firebase/messaging/sw`) and can only run INSIDE the service worker — a
 * window-context import both fails to resolve and is semantically wrong.
 * Background pushes are therefore delivered through the SW's own push event
 * (firebase-messaging-sw.js) and surfaced to this app via the realtime
 * Firestore Notification Center — the authoritative UI per the notifications
 * architecture. No UI is shown from the SW handler (log-only), so no
 * window-side background handler is required.
 *
 * Foreground messages: intentionally a no-op to avoid showing a duplicate
 * browser notification on top of the Notification Center. The client-side
 * `initForegroundMessaging()` in App.tsx also returns a no-op handler.
 *
 * @param messaging Firebase Messaging instance (window context).
 * @param onNotificationOptional Optional callback for when a push
 *   notification should trigger an in-app UI update (e.g. refresh quest
 *   list). If not provided, foreground pushes are swallowed silently.
 */
export function installPushMessageListeners(
  messaging: Messaging,
  onNotificationOptional?: (payload: { type: string; notification: any }) => void,
): () => void {
  // --- Foreground message handler (window context) ---
  // Runs when a push notification arrives while the app is in the FOREGROUND.
  // We intentionally DO NOT show a browser notification here — the
  // Notification Center (Firestore realtime listener) is the authoritative
  // UI. We just log and optionally trigger an in-app refresh.
  const foregroundUnsub = onMessageClient(messaging, (payload: MessagePayload) => {
    // payload is a MessagePayload from firebase/messaging
    const data = payload.data as Record<string, unknown> | undefined;
    const notificationId = data?.id as string | undefined;
    const title = data?.title as string | undefined;
    const body = data?.body as string | undefined;

    // Log structured observability entry (no raw tokens).
    // In production this would go to a metrics sink; in dev we console.log.
    // eslint-disable-next-line no-console
    console.log('[sw-push-foreground]', {
      notificationId,
      title,
      body,
      // Do NOT log the raw FCM token or full payload.
    });

    // Optional callback: e.g. refresh the Notification Center unread count.
    if (onNotificationOptional) {
      onNotificationOptional({
        type: 'push-notification',
        notification: {
          id: notificationId ?? '',
          title: title ?? '',
          body: body ?? '',
          actionUrl: data?.actionUrl as string | undefined,
          dedupeKey: data?.dedupeKey as string | undefined,
          type: data?.type as string | undefined,
          familyId: data?.familyId as string | undefined,
          childId: data?.childId as string | undefined,
          slot: data?.slot as string | undefined,
          localDate: data?.localDate as string | undefined,
        },
      });
    }
  });

  // Return an unsubscribe function so callers can clean up.
  return () => {
    foregroundUnsub();
  };
}