import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  installServiceWorkerControllerListener,
  LEGACY_SW_MIGRATION_ID,
} from './serviceWorkerUpdate';
import { getStartupPhase, logStartupDiagnostic } from './startupDiagnostics';

vi.mock('./startupDiagnostics', () => ({
  reportStartupPhase: vi.fn(),
  getStartupPhase: vi.fn(),
  logStartupDiagnostic: vi.fn(),
}));

describe('service worker controller listener (post-fix)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(logStartupDiagnostic).mockClear();
    vi.mocked(getStartupPhase).mockReset();
  });

  it('does not attach a listener on the first install (no controller)', () => {
    const serviceWorker = { controller: null, addEventListener: vi.fn() };
    installServiceWorkerControllerListener(serviceWorker);
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });

  it('logs a bootstrap diagnostic and schedules one guarded migration reload', () => {
    vi.useFakeTimers();
    vi.mocked(getStartupPhase).mockReturnValue('auth');

    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };

    const storage = new Map<string, string>();
    const reload = vi.fn();
    installServiceWorkerControllerListener(serviceWorker, {
      migrationId: LEGACY_SW_MIGRATION_ID,
      reload,
      reloadDelayMs: 25,
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    });
    controllerChange?.();
    controllerChange?.();
    vi.advanceTimersByTime(25);

    expect(logStartupDiagnostic).toHaveBeenCalledWith(
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'auth' },
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.get(`queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`)).toBe('reloading');
  });

  it('stays silent when a controllerchange fires after bootstrap is ready', () => {
    vi.mocked(getStartupPhase).mockReturnValue('ready');

    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };

    installServiceWorkerControllerListener(serviceWorker);
    controllerChange?.();

    expect(logStartupDiagnostic).not.toHaveBeenCalled();
  });
});
