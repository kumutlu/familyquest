import { getStartupPhase, logStartupDiagnostic, subscribeStartupPhase } from './startupDiagnostics';
import { FAMILYQUEST_BUILD } from './buildInfo';
import type { StartupPhase } from './components/layout/startupState';

type ServiceWorkerUpdateSource = {
  controller: unknown;
  addEventListener: (name: 'controllerchange', listener: () => void) => void;
};

/**
 * Observes service-worker `controllerchange` events WITHOUT auto-reloading.
 *
 * With the corrected PWA lifecycle (`registerType: 'prompt'`,
 * `clientsClaim: false`) a `controllerchange` should not fire while an open tab
 * is mid-bootstrap — the new worker stays in the `waiting` state and only
 * activates on a safe reload/new navigation. If a `controllerchange` *does*
 * occur during bootstrap, we record it as a diagnostic instead of reloading:
 * an automatic reload would mask the real failure and re-race the SW takeover,
 * which is exactly the bug we are removing.
 */
export function installServiceWorkerControllerListener(
  serviceWorker: ServiceWorkerUpdateSource | undefined = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : undefined,
): void {
  if (!serviceWorker?.controller) return;

  serviceWorker.addEventListener('controllerchange', () => {
    const phase = getStartupPhase();
    if (phase !== 'ready') {
      logStartupDiagnostic('SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP', { phase });
    }
    // Intentionally no `window.location.reload()` here. The new version is
    // applied on the user's next navigation/reload, which is safe and does not
    // interrupt an in-flight bootstrap.
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
