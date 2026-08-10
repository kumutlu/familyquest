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
  | 'SERVICE_WORKER_CONTROLLER_CHANGE_DURING_BOOTSTRAP';

// Module-level snapshot of the current startup phase. Written by the
// StartupScreen effect and read by the service-worker controllerchange handler
// so it can tell whether a controller change happened mid-bootstrap.
let currentPhase: StartupPhase | 'unknown' = 'unknown';

export function reportStartupPhase(phase: StartupPhase): void {
  currentPhase = phase;
}

export function getStartupPhase(): StartupPhase | 'unknown' {
  return currentPhase;
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
