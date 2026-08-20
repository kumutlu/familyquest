import type { StartupPhase } from './components/layout/startupState';

/**
 * Non-sensitive startup diagnostic codes.
 *
 * These are emitted to the console (development/diagnostic only) so a
 * "Connection problem" screen can be triaged without guessing which phase
 * stalled. They deliberately carry NO user-identifying or credential data.
 */
export type StartupDiagnosticCode =
  | 'AUTH_TIMEOUT'
  | 'PROFILE_LOAD_TIMEOUT'
  | 'FAMILY_LOAD_TIMEOUT'
  | 'CHUNK_LOAD_ERROR'
  | 'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP'
  | 'SERVICE_WORKER_UPDATE_DEFERRED_DURING_BOOTSTRAP';

export type StartupStage =
  | 'APP_SCRIPT_READY'
  | 'REACT_MOUNT_START'
  | 'REACT_MOUNTED'
  | 'AUTH_LISTENER_ATTACHED'
  | 'AUTH_RESOLVED'
  | 'PROFILE_START'
  | 'PROFILE_CACHE_RESULT'
  | 'PROFILE_SERVER_CONFIRMED'
  | 'FAMILY_START'
  | 'FAMILY_CACHE_RESULT'
  | 'FAMILY_SERVER_CONFIRMED'
  | 'CRITICAL_BOOTSTRAP_COMPLETE'
  | 'ROUTE_RENDERED'
  | 'DASHBOARD_FIRST_RENDER';

export type OptionalStartupResource = 'MEMBERS' | 'TASKS' | 'REWARDS' | 'WALLETS';

export interface StartupMetrics {
  marks: Partial<Record<StartupStage, number>>;
  durations: Record<string, number>;
  optional: Partial<Record<OptionalStartupResource, number>>;
}

let metrics: StartupMetrics = { marks: {}, durations: {}, optional: {} };
const optionalStarts: Partial<Record<OptionalStartupResource, number>> = {};
const optionalEnds: Partial<Record<OptionalStartupResource, number>> = {};

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const round = (value: number) => Math.round(value * 10) / 10;

const publishMetrics = () => {
  if (typeof window === 'undefined') return;
  (window as typeof window & { __QUEKI_STARTUP_METRICS__?: StartupMetrics }).__QUEKI_STARTUP_METRICS__ = getStartupMetrics();
};

const deriveDuration = (name: string, start: StartupStage, end: StartupStage) => {
  const startTime = metrics.marks[start];
  const endTime = metrics.marks[end];
  if (startTime === undefined || endTime === undefined) return;
  metrics.durations[name] = round(endTime - startTime);
  try { performance.measure(`QUEKI:${name}`, `QUEKI:${start}`, `QUEKI:${end}`); } catch { /* unsupported */ }
};

export function resetStartupMetrics(): void {
  metrics = { marks: {}, durations: {}, optional: {} };
  for (const key of Object.keys(optionalStarts) as OptionalStartupResource[]) delete optionalStarts[key];
  for (const key of Object.keys(optionalEnds) as OptionalStartupResource[]) delete optionalEnds[key];
  publishMetrics();
}

export function markStartupStage(stage: StartupStage, timestamp = now()): void {
  if (metrics.marks[stage] !== undefined) return;
  metrics.marks[stage] = round(timestamp);
  try { performance.mark(`QUEKI:${stage}`); } catch { /* unsupported */ }
  deriveDuration('REACT_MOUNT', 'REACT_MOUNT_START', 'REACT_MOUNTED');
  deriveDuration('AUTH_RESOLUTION', 'AUTH_LISTENER_ATTACHED', 'AUTH_RESOLVED');
  deriveDuration('PROFILE_SERVER', 'PROFILE_START', 'PROFILE_SERVER_CONFIRMED');
  deriveDuration('FAMILY_SERVER', 'FAMILY_START', 'FAMILY_SERVER_CONFIRMED');
  deriveDuration('CRITICAL_BOOTSTRAP', 'APP_SCRIPT_READY', 'CRITICAL_BOOTSTRAP_COMPLETE');
  deriveDuration('DASHBOARD_FIRST_RENDER', 'APP_SCRIPT_READY', 'DASHBOARD_FIRST_RENDER');
  publishMetrics();
}

export function startStartupResource(resource: OptionalStartupResource, timestamp = now()): void {
  optionalStarts[resource] = timestamp;
}

export function finishStartupResource(resource: OptionalStartupResource, timestamp = now()): void {
  const start = optionalStarts[resource];
  if (start === undefined) return;
  metrics.optional[resource] = round(timestamp - start);
  optionalEnds[resource] = timestamp;
  const resources: OptionalStartupResource[] = ['MEMBERS', 'TASKS', 'REWARDS', 'WALLETS'];
  if (resources.every(key => optionalStarts[key] !== undefined && optionalEnds[key] !== undefined)) {
    metrics.durations.OPTIONAL_BOOTSTRAP = round(
      Math.max(...resources.map(key => optionalEnds[key]!)) - Math.min(...resources.map(key => optionalStarts[key]!)),
    );
  }
  publishMetrics();
}

export function getStartupMetrics(): StartupMetrics {
  return {
    marks: { ...metrics.marks },
    durations: { ...metrics.durations },
    optional: { ...metrics.optional },
  };
}

// Module-level snapshot of the current startup phase. Written by the
// StartupScreen effect and read by the service-worker controllerchange handler
// so it can tell whether a controller change happened mid-bootstrap.
let currentPhase: StartupPhase | 'unknown' = 'unknown';

// Listeners notified whenever the startup phase changes. Used to flush a
// deferred service-worker update once bootstrap completes (see
// `serviceWorkerUpdate.ts`), without coupling that module to React.
const phaseListeners = new Set<(phase: StartupPhase | 'unknown') => void>();

export function reportStartupPhase(phase: StartupPhase | 'unknown'): void {
  currentPhase = phase;
  for (const listener of phaseListeners) listener(phase);
}

export function getStartupPhase(): StartupPhase | 'unknown' {
  return currentPhase;
}

/**
 * Subscribes to startup-phase changes. Returns an unsubscribe function.
 *
 * The service-worker update handler uses this to apply a deferred waiting
 * worker only after the app has finished bootstrapping.
 */
export function subscribeStartupPhase(
  listener: (phase: StartupPhase | 'unknown') => void,
): () => void {
  phaseListeners.add(listener);
  return () => {
    phaseListeners.delete(listener);
  };
}

// Keys that must never be attached to a diagnostic, as a defensive guard
// against accidentally logging sensitive material.
const SENSITIVE_KEY_PATTERN = /uid|email|token|family|firebase|key|credential|password|phone/i;

/**
 * Emits a non-sensitive startup diagnostic to the console.
 *
 * Callers must not pass sensitive values, and as a second line of defence any
 * detail key matching a sensitive pattern is dropped before logging. No UID,
 * email, auth token, family ID, or Firebase configuration is ever attached.
 */
export function logStartupDiagnostic(
  code: StartupDiagnosticCode,
  detail: Record<string, unknown> = {},
): void {
  const safeDetail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    safeDetail[key] = value;
  }
  // eslint-disable-next-line no-console
  console.error('[StartupDiagnostic]', code, safeDetail);
}

// ---------------------------------------------------------------------------
// Deterministic E2E test hook.
//
// Exposes `reportStartupPhase` on `window` so a Playwright harness can drive the
// startup phase through the EXACT same production path the `StartupScreen`
// effect uses. This lets the safe service-worker update lifecycle be exercised
// deterministically (defer-while-bootstrapping vs. apply-when-ready) without
// depending on a live Firebase auth/profile/family resolution. It is a pure
// pass-through to the real module function — no separate code path is created.
//
// GATING: this hook is ONLY compiled into the dedicated service-worker
// lifecycle E2E artifacts, which are built with `VITE_SW_E2E_HOOK=1` (see
// `scripts/build-sw-e2e-artifacts.mjs`). Every real production/preview build
// leaves this block compiled out, so no production-global test hook is exposed.
// Even where it is present, it is a pure pass-through to `reportStartupPhase`
// (the exact function the StartupScreen effect calls) and cannot alter
// application state in an unsafe way.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined' && import.meta.env.VITE_SW_E2E_HOOK) {
  (window as typeof window & {
    __reportStartupPhase?: (phase: StartupPhase | 'unknown') => void;
  }).__reportStartupPhase = reportStartupPhase;
}
