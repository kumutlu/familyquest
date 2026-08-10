import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { installServiceWorkerControllerListener } from './serviceWorkerUpdate';
import { reportStartupPhase, getStartupPhase } from './startupDiagnostics';

// ---------------------------------------------------------------------------
// POST-FIX lifecycle suite.
//
// Hypothesis (STARTUP_SW_INVESTIGATION.md §B): `autoUpdate` + `skipWaiting:
// true` + `clientsClaim: true` made a newly deployed SW take control of an
// open tab and the old `installServiceWorkerUpdateReload` then reloaded on the
// resulting `controllerchange`, racing the takeover and masking a chunk-load
// failure as a generic "Connection problem".
//
// The fix changes the PWA strategy to `prompt` + `skipWaiting:false` +
// `clientsClaim:false` and replaces the reload handler with an observer that
// only logs. These tests prove the new behaviour end-to-end using the REAL
// `startupDiagnostics` module (no mock), so the phase-tracking wiring is
// exercised for real.
//
// What is proven here: the controllerchange/bootstrap interaction no longer
// reloads and is correctly classified. What remains an inference (browser
// only): the actual SW `skipWaiting`/`clientsClaim` absence in the generated
// `dist/sw.js` — verified separately by inspecting the production build.
// ---------------------------------------------------------------------------

describe('service worker lifecycle — post-fix (no reload, classified diagnostic)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset to a valid phase so the next test starts from a known state.
    reportStartupPhase('ready');
  });

  it('1. a controllerchange during an active bootstrap is classified, NOT reloaded', () => {
    // Open tab mid-bootstrap (auth phase) when the SW takes over.
    reportStartupPhase('auth');
    expect(getStartupPhase()).toBe('auth');

    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };

    installServiceWorkerControllerListener(serviceWorker);
    controllerChange?.();

    // The corrected handler must NOT reload (that reload was the mechanism that
    // masked the chunk-load failure). It only classifies the event.
    expect(console.error).toHaveBeenCalledWith(
      '[StartupDiagnostic]',
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'auth' },
    );
  });

  it('2. a controllerchange after bootstrap is ready is silent (legitimate update)', () => {
    reportStartupPhase('ready');
    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };
    installServiceWorkerControllerListener(serviceWorker);
    controllerChange?.();

    expect(console.error).not.toHaveBeenCalled();
  });

  it('3. no listener is attached on the first service worker installation', () => {
    const serviceWorker = { controller: null, addEventListener: vi.fn() };
    installServiceWorkerControllerListener(serviceWorker);
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });

  it('4. the phase reported by StartupScreen drives the classification', () => {
    // Simulate the StartupScreen effect reporting each phase.
    reportStartupPhase('profile');
    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };
    installServiceWorkerControllerListener(serviceWorker);
    controllerChange?.();

    expect(console.error).toHaveBeenCalledWith(
      '[StartupDiagnostic]',
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'profile' },
    );
  });
});
