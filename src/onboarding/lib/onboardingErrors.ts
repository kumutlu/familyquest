import type { TFunction } from 'i18next';

/**
 * Bounded timeout wrapper. Races an async operation against a hard deadline so
 * a stalled network call can never leave the UI in an indefinite loading state
 * (PRIORITY 2 requirement: "loading cannot remain indefinitely"). On timeout it
 * rejects with a *human-readable* message — never a raw Firebase string. This
 * is a recovery deadline, not a sleep used to hide an error.
 */
export function withBoundedTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Maps any error thrown by an onboarding setup operation to a localised,
 * non-technical message. Critically it NEVER surfaces raw Firebase / internal
 * strings such as "User not found" — those are collapsed to a generic, friendly
 * fallback so a user can never land on a context-less internal error screen.
 */
export function classifyOnboardingError(
  error: unknown,
  t: TFunction<'onboarding'>,
  fallbackKey: 'errors.familyFailed' | 'errors.childFailed' | 'errors.taskFailed' | 'errors.profileUnavailable',
): string {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message = err?.message ?? '';

  // Network / connectivity failures get the dedicated offline copy.
  if (
    code === 'unavailable' ||
    code === 'auth/network-request-failed' ||
    code === 'deadline-exceeded' ||
    /network|offline|failed-precondition|deadline/i.test(message)
  ) {
    return t('errors.offline');
  }

  // Internal / raw strings must never reach the user.
  if (/user not found|already has a family|permission-denied|internal/i.test(message)) {
    return t(fallbackKey);
  }

  return t(fallbackKey);
}

/** Deadline (ms) for the authoritative profile document to become available. */
export const PROFILE_WAIT_MS = 20_000;

/** Deadline (ms) for a single setup operation (family/child/task) to settle. */
export const SETUP_WAIT_MS = 30_000;
