/**
 * Deterministic startup phases for the global loading experience.
 *
 * The application bootstrap has four sequential gates:
 *   1. `auth`    — Firebase Auth has not resolved the first auth state yet.
 *   2. `profile` — signed in, but the `users/{uid}` document has not arrived.
 *   3. `family`  — profile has a familyId, but the family listeners have not
 *                  all reported ready (`appReady`).
 *   4. `ready`   — the app can render, or the router can redirect (login /
 *                  onboarding).
 *
 * Any recorded bootstrap error short-circuits to `error` so the user always
 * gets a recoverable screen instead of an indefinite spinner.
 */
export type StartupPhase = 'auth' | 'profile' | 'family' | 'ready' | 'error';

export interface StartupSnapshot {
  authStatus: 'initializing' | 'authenticated' | 'unauthenticated';
  authUser: unknown | null | undefined;
  currentUser: { familyId?: string | null } | null;
  appReady: boolean;
  bootstrapError: string | null;
}

export function deriveStartupPhase(snapshot: StartupSnapshot): StartupPhase {
  if (snapshot.bootstrapError) return 'error';
  if (snapshot.authStatus === 'initializing') return 'auth';
  // Signed out: the router owns the redirect to /login, never a loading screen.
  if (snapshot.authStatus === 'unauthenticated' || snapshot.authUser === null) return 'ready';
  if (snapshot.currentUser === null) return 'profile';
  if (snapshot.currentUser.familyId && !snapshot.appReady) return 'family';
  return 'ready';
}
