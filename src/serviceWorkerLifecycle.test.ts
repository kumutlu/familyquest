import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  installServiceWorkerControllerListener,
  LEGACY_SW_MIGRATION_ID,
} from './serviceWorkerUpdate';
import { reportStartupPhase, getStartupPhase } from './startupDiagnostics';

// ---------------------------------------------------------------------------
// ONE-RELEASE migration lifecycle suite.
//
// Hypothesis (STARTUP_SW_INVESTIGATION.md §B): `autoUpdate` + `skipWaiting:
// true` + `clientsClaim: true` made a newly deployed SW take control of an
// open tab and the old `installServiceWorkerUpdateReload` then reloaded on the
// resulting `controllerchange`, racing the takeover and masking a chunk-load
// failure as a generic "Connection problem".
//
// The later 82422c8 rescue release temporarily enables claim/activation and
// installs a migration-id-gated listener with an at-most-once fallback reload.
// These tests exercise that current production contract using the REAL
// `startupDiagnostics` module (no mock).
//
// Browser activation and the subsequent normal-release reload are covered by
// tests/e2e/sw-lifecycle.spec.ts. This file proves the listener's diagnostic,
// migration reload count, and persisted no-loop marker.
// ---------------------------------------------------------------------------

describe('service worker lifecycle — one-time legacy migration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Reset to a valid phase so the next test starts from a known state.
    reportStartupPhase('ready');
  });

  it('1. classifies a bootstrap takeover and performs exactly one migration fallback reload', () => {
    // Open tab mid-bootstrap (auth phase) when the SW takes over.
    reportStartupPhase('auth');
    expect(getStartupPhase()).toBe('auth');

    let controllerChange: (() => void) | undefined;
    const controller = { state: 'activated' };
    const serviceWorker = {
      controller,
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === 'controllerchange') controllerChange = listener;
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

    expect(console.error).toHaveBeenCalledWith(
      '[StartupDiagnostic]',
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'auth' },
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.get(`queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`)).toBe('reloading');
    expect(serviceWorker.controller).toBe(controller);
    expect(serviceWorker.controller.state).toBe('activated');
  });

  it('2. a normal release without a migration id attaches no reload listener', () => {
    reportStartupPhase('ready');
    let controllerChange: (() => void) | undefined;
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((_name: string, listener: () => void) => {
        controllerChange = listener;
      }),
    };
    const reload = vi.fn();
    installServiceWorkerControllerListener(serviceWorker, { reload });
    controllerChange?.();

    expect(console.error).not.toHaveBeenCalled();
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(0);
  });

  it('3. no listener is attached on the first service worker installation', () => {
    const serviceWorker = { controller: null, addEventListener: vi.fn() };
    installServiceWorkerControllerListener(serviceWorker);
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });

  it('4. a persisted migration marker prevents a reload loop after navigation', () => {
    reportStartupPhase('profile');
    let controllerChange: (() => void) | undefined;
    const controller = { state: 'activated' };
    const serviceWorker = {
      controller,
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === 'controllerchange') controllerChange = listener;
      }),
    };
    const storageKey = `queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`;
    const storage = new Map([[storageKey, 'reloading']]);
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
    vi.advanceTimersByTime(25);

    expect(console.error).toHaveBeenCalledWith(
      '[StartupDiagnostic]',
      'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP',
      { phase: 'profile' },
    );
    expect(reload).toHaveBeenCalledTimes(0);
    expect(storage.get(storageKey)).toBe('reloading');
    expect(serviceWorker.controller.state).toBe('activated');
  });
});
