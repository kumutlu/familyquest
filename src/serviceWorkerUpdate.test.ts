import { describe, expect, it, vi } from 'vitest';
import { installServiceWorkerUpdateReload } from './serviceWorkerUpdate';

describe('service worker update recovery', () => {
  it('reloads an already-controlled page once when a new worker takes control', () => {
    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };
    const reload = vi.fn();

    installServiceWorkerUpdateReload(serviceWorker, reload);
    controllerChange?.();
    controllerChange?.();

    expect(serviceWorker.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first service worker installation', () => {
    const serviceWorker = { controller: null, addEventListener: vi.fn() };

    installServiceWorkerUpdateReload(serviceWorker, vi.fn());

    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });
});
