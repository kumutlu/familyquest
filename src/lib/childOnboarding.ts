import { isChildRole } from './roles';

/**
 * Pure helpers that decide whether the Parent First-Run Child Onboarding flow
 * should be shown. Kept framework-free so both `AppLayout` (runtime redirect)
 * and the unit tests can reuse the exact same logic.
 */

/** Number of child-role members in a family member list. */
export function countChildren(familyMembers: any[] = []): number {
  return familyMembers.filter((m) => isChildRole(m?.role)).length;
}

export interface ChildOnboardingGate {
  /** Authenticated user document (must have a familyId to qualify). */
  currentUser: any;
  /** Realtime family member list. */
  familyMembers: any[];
  /** True once the bootstrap queries that load `familyMembers` have resolved. */
  appReady: boolean;
  /** Current router pathname. */
  pathname: string;
}

/**
 * Whether the child-onboarding flow should auto-start.
 *
 * Entry condition (all must hold):
 *  - bootstrap finished (`appReady`) so `familyMembers` is authoritative,
 *  - the parent belongs to a family,
 *  - the family currently contains zero child profiles,
 *  - we are not already on the onboarding route (avoids a redirect loop).
 *
 * Once at least one child exists the flow must never show again — that rule is
 * enforced here by the `countChildren(...) === 0` check.
 */
export function shouldStartChildOnboarding({
  currentUser,
  familyMembers,
  appReady,
  pathname,
}: ChildOnboardingGate): boolean {
  if (!appReady) return false;
  if (!currentUser?.familyId) return false;
  if (pathname === '/child-onboarding') return false;
  return countChildren(familyMembers) === 0;
}

/** localStorage key used to resume the flow at the last-reached step. */
export function childOnboardingStepKey(familyId: string | null | undefined): string | null {
  if (!familyId) return null;
  return `fq:childOnboarding:${familyId}:step`;
}

/** Persist the current step so a mid-flow refresh resumes safely. */
export function saveChildOnboardingStep(familyId: string | null | undefined, step: number): void {
  const key = childOnboardingStepKey(familyId);
  if (!key) return;
  try {
    localStorage.setItem(key, String(step));
  } catch {
    /* storage unavailable (private mode / SSR) — resume is best-effort */
  }
}

/** Read the persisted step, or 1 when none is stored. */
export function loadChildOnboardingStep(familyId: string | null | undefined): number {
  const key = childOnboardingStepKey(familyId);
  if (!key) return 1;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  } catch {
    return 1;
  }
}

/** Clear the persisted step once onboarding is finished. */
export function clearChildOnboardingStep(familyId: string | null | undefined): void {
  const key = childOnboardingStepKey(familyId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
