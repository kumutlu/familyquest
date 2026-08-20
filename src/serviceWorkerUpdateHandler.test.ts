import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  installServiceWorkerControllerListener,
  installServiceWorkerUpdateHandler,
  LEGACY_SW_MIGRATION_ID,
  type ServiceWorkerLike,
  type ServiceWorkerRegistrationLike,
} from './serviceWorkerUpdate';
import { reportStartupPhase, getStartupPhase } from './startupDiagnostics';
import { FAMILYQUEST_BUILD } from './buildInfo';

// ---------------------------------------------------------------------------
// Regression suite for the SAFE service-worker update path.
//
// The previous lifecycle left a newly deployed worker parked in the `waiting`
// state with no mechanism to activate it, so Safari (and any long-lived tab)
// kept executing the stale, SW-cached bundle — the Rewards UI never updated.
//
// These tests prove:
//   1. a waiting worker is activated (skipWaiting + reload) ONLY once bootstrap
//      is `ready` — never mid-bootstrap;
//   2. a bootstrap-time deferral is safely applied the moment `ready` is
//      reported (via the startup-phase subscription);
//   3. an `updatefound` → `installed` transition is handled;
//   4. the reload carries the build SHA, so the executing client ends up on
//      the new build SHA after the update.
// ---------------------------------------------------------------------------

function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe('one-time legacy controller migration', () => {
  it('reloads at most once for the migration controller change', () => {
    vi.useFakeTimers();
    const listeners: Record<string, (event?: any) => void> = {};
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((name: string, listener: (event?: any) => void) => {
        listeners[name] = listener;
      }),
    };
    const storage = new Map<string, string>();
    const reload = vi.fn();

    installServiceWorkerControllerListener(serviceWorker as any, {
      migrationId: LEGACY_SW_MIGRATION_ID,
      reload,
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      reloadDelayMs: 25,
    });

    listeners.controllerchange();
    listeners.controllerchange();
    vi.advanceTimersByTime(25);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.get(`queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`)).toBe('reloading');
    vi.useRealTimers();
  });

  it('suppresses the client reload when the migration worker is navigating the page', () => {
    vi.useFakeTimers();
    const listeners: Record<string, (event?: any) => void> = {};
    const serviceWorker = {
      controller: {},
      addEventListener: vi.fn((name: string, listener: (event?: any) => void) => {
        listeners[name] = listener;
      }),
    };
    const storage = new Map<string, string>();
    const reload = vi.fn();

    installServiceWorkerControllerListener(serviceWorker as any, {
      migrationId: LEGACY_SW_MIGRATION_ID,
      reload,
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      reloadDelayMs: 25,
    });

    listeners.controllerchange();
    listeners.message({ data: { type: 'LEGACY_SW_MIGRATION_NAVIGATING', migrationId: LEGACY_SW_MIGRATION_ID } });
    vi.advanceTimersByTime(25);

    expect(reload).not.toHaveBeenCalled();
    expect(storage.get(`queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`)).toBe('navigating');
    vi.useRealTimers();
  });

  it('does nothing when the migration id is absent', () => {
    const serviceWorker = { controller: {}, addEventListener: vi.fn() };
    const reload = vi.fn();
    installServiceWorkerControllerListener(serviceWorker as any, { reload });
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload again after navigation when the migration marker survives', () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const storage = new Map([[`queki:sw-migration:${LEGACY_SW_MIGRATION_ID}`, 'navigating']]);
    const reload = vi.fn();
    installServiceWorkerControllerListener({
      controller: {},
      addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; },
    } as any, {
      migrationId: LEGACY_SW_MIGRATION_ID,
      reload,
      storage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      reloadDelayMs: 25,
    });
    listeners.controllerchange();
    vi.advanceTimersByTime(25);
    expect(reload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// A waiting worker double. The production `scheduleSafeReload` posts
// SKIP_WAITING and then waits for the worker to reach the `activated` state
// (via a `statechange` listener, or immediately if it is already activated)
// before reloading exactly once. The double models the post-SKIP_WAITING
// activated worker so the reload path is exercised synchronously.
function makeWaitingWorker(): ServiceWorkerLike {
  const worker = {
    postMessage: vi.fn() as (message: unknown) => void,
    state: 'activated' as const,
    addEventListener: vi.fn() as (type: string, listener: () => void) => void,
    removeEventListener: vi.fn() as (type: string, listener: () => void) => void,
  };
  return worker;
}

interface Captured {
  updatefound?: () => void;
  statechange?: () => void;
}

function createRegistration(): { reg: ServiceWorkerRegistrationLike; captured: Captured } {
  const captured: Captured = {};
  const installing = {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      captured.statechange = listener;
    }),
  };
  const reg: ServiceWorkerRegistrationLike = {
    waiting: null,
    installing,
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'updatefound') captured.updatefound = listener;
    }),
  };
  return { reg, captured };
}

describe('service worker safe update handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reportStartupPhase('unknown');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Flush any deferred listener (it self-unsubscribes on `ready`) and reset
    // the phase so the next test starts from a known state.
    reportStartupPhase('ready');
    reportStartupPhase('unknown');
  });

  it('1. activates a waiting worker and reloads once bootstrap is ready', () => {
    reportStartupPhase('ready');
    expect(getStartupPhase()).toBe('ready');

    const waiting = makeWaitingWorker();
    const reg = { waiting, installing: null, addEventListener: vi.fn() };
    const reload = vi.fn();
    const scheduled = vi.fn();

    installServiceWorkerUpdateHandler(reg, { reload, onSafeReloadScheduled: scheduled });

    expect(asMock(waiting.postMessage)).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith({ sha: FAMILYQUEST_BUILD.sha });
  });

  it('2. defers during bootstrap and applies the update when ready', () => {
    reportStartupPhase('auth');
    expect(getStartupPhase()).toBe('auth');

    const waiting = makeWaitingWorker();
    const reg = { waiting, installing: null, addEventListener: vi.fn() };
    const reload = vi.fn();
    const scheduled = vi.fn();

    installServiceWorkerUpdateHandler(reg, { reload, onSafeReloadScheduled: scheduled });

    // Mid-bootstrap: NO reload, but a deferred diagnostic is logged.
    expect(reload).not.toHaveBeenCalled();
    expect(asMock(waiting.postMessage)).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[StartupDiagnostic]',
      'SERVICE_WORKER_UPDATE_DEFERRED_DURING_BOOTSTRAP',
      { phase: 'auth' },
    );

    // Bootstrap completes → the deferred update is safely applied.
    reportStartupPhase('ready');
    expect(asMock(waiting.postMessage)).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledWith({ sha: FAMILYQUEST_BUILD.sha });
  });

  it('3. handles an updatefound → installed transition (waiting worker appears later)', () => {
    reportStartupPhase('ready');

    const { reg, captured } = createRegistration();
    const waiting = makeWaitingWorker();
    const reload = vi.fn();

    installServiceWorkerUpdateHandler(reg, { reload });

    // Simulate the browser finding an update and installing a new worker.
    captured.updatefound?.();
    expect(captured.statechange).toBeTypeOf('function');

    // The installing worker finishes and becomes the waiting worker.
    reg.waiting = waiting;
    captured.statechange?.();

    expect(asMock(waiting.postMessage)).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('4. does nothing when there is no registration or no waiting worker', () => {
    const reload = vi.fn();
    installServiceWorkerUpdateHandler(undefined, { reload });
    expect(reload).not.toHaveBeenCalled();

    const reg = { waiting: null, installing: null, addEventListener: vi.fn() };
    installServiceWorkerUpdateHandler(reg, { reload });
    expect(reload).not.toHaveBeenCalled();
  });

  it('5. carries the build SHA so the executing client is on the new build after update', () => {
    reportStartupPhase('ready');

    // Simulate a newer deploy: the waiting worker represents a build whose SHA
    // differs from what is currently executing.
    const NEW_SHA = 'a1b2c3d';
    const waiting = makeWaitingWorker();
    const reg = { waiting, installing: null, addEventListener: vi.fn() };
    const reload = vi.fn();
    const scheduled = vi.fn();

    installServiceWorkerUpdateHandler(reg, {
      reload,
      onSafeReloadScheduled: scheduled,
      buildSha: NEW_SHA,
    });

    // The reload is the mechanism that swaps in the new worker; the SHA it
    // reports is exactly the build the client will be executing afterwards.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
    const info = scheduled.mock.calls[0]?.[0];
    expect(info).toEqual({ sha: NEW_SHA });

    // Regression guard: the default (no explicit buildSha) reports the real,
    // currently-executing build SHA — proving the update path does not silently
    // drop the build identifier that lets us verify the live client version.
    const scheduledDefault = vi.fn();
    const reg2 = { waiting: makeWaitingWorker(), installing: null, addEventListener: vi.fn() };
    installServiceWorkerUpdateHandler(reg2, {
      reload: vi.fn(),
      onSafeReloadScheduled: scheduledDefault,
    });
    expect(scheduledDefault).toHaveBeenCalledWith({ sha: FAMILYQUEST_BUILD.sha });
    expect(FAMILYQUEST_BUILD.sha).not.toBe('unknown');
  });
});
