type ServiceWorkerUpdateSource = {
  controller: unknown;
  addEventListener: (name: 'controllerchange', listener: () => void) => void;
};

export function installServiceWorkerUpdateReload(
  serviceWorker: ServiceWorkerUpdateSource | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  reload: () => void = () => window.location.reload(),
) {
  if (!serviceWorker?.controller) return;

  let refreshing = false;
  serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    reload();
  });
}
