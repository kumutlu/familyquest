import { getStartupPhase, logStartupDiagnostic } from './startupDiagnostics';

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
