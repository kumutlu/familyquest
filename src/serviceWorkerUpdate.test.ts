import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { installServiceWorkerControllerListener } from './serviceWorkerUpdate';
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
    vi.restoreAllMocks();
    vi.mocked(logStartupDiagnostic).mockClear();
    vi.mocked(getStartupPhase).mockReset();
  });

  it('does not attach a listener on the first install (no controller)', () => {
    const serviceWorker = { controller: null, addEventListener: vi.fn() };
    installServiceWorkerControllerListener(serviceWorker);
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });

  it('does NOT reload and logs a diagnostic when a controllerchange fires during bootstrap', () => {
    // The corrected lifecycle must never auto-reload mid-bootstrap; that reload
    // was the mechanism that masked the chunk-load failure as a generic error.
    vi.mocked(getStartupPhase).mockReturnValue('auth');

    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };

    installServiceWorkerControllerListener(serviceWorker);
    controllerChange?.();

    expect(logStartupDiagnostic).toHaveBeenCalledWith(
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'auth' },
    );
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
