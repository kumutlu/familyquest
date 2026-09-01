/**
 * Onboarding draft persistence.
 *
 * The draft holds ONLY non-authoritative, low-sensitivity personalisation
 * (first names, a display relationship, a family name, and the post-auth
 * reconciliation ids used to make setup idempotent). It MUST NEVER contain
 * credentials, auth tokens, wallet balances, point balances, or any other
 * sensitive/authoritative value. See the product decision: "queki.onboardingDraft
 * may contain only non-authoritative onboarding state."
 *
 * Storage strategy (mirrors the proven `inviteLink.rememberPendingInvite`
 * pattern): `sessionStorage` is the primary (tab-scoped, cleared on tab close),
 * `localStorage` is a mirror that survives the full-page reloads some auth
 * providers perform (Google redirect on mobile). Both are written on save and
 * cleared together on reset.
 */

export type Step =
  | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7'
  | 'p1' | 'p2' | 'p3';

export const PRE_AUTH_STEPS: Step[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
export const POST_AUTH_STEPS: Step[] = ['p1', 'p2', 'p3'];

export const ONBOARDING_DRAFT_KEY = 'queki.onboardingDraft';
export const DRAFT_VERSION = 1 as const;

export interface OnboardingDraft {
  version: typeof DRAFT_VERSION;
  step: Step;
  parentFirstName: string;
  /** Display-only relationship (Mum/Dad/…). Never a security role. */
  parentRoleDisplay: string;
  childFirstName: string;
  /** Stable identity for the first onboarding child across retries/reloads. */
  firstChildRequestId?: string;
  /** Stable identity for the first onboarding task across retries/reloads. */
  firstTaskRequestId?: string;
  familyName: string;
  // Post-auth reconciliation ids. Persisted so refresh/retry is idempotent.
  familyId?: string;
  childId?: string;
  firstTaskId?: string;
  authProvider?: 'google' | 'email';
  updatedAt: number;
}

function createOnboardingRequestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyDraft(step: Step = 's1'): OnboardingDraft {
  return {
    version: DRAFT_VERSION,
    step,
    parentFirstName: '',
    parentRoleDisplay: '',
    childFirstName: '',
    firstChildRequestId: createOnboardingRequestId(),
    firstTaskRequestId: createOnboardingRequestId(),
    familyName: '',
    updatedAt: Date.now(),
  };
}

function availableStorages(): Storage[] {
  const found: Storage[] = [];
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) found.push(sessionStorage);
  } catch {
    /* storage blocked (private mode / SSR) */
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage) found.push(localStorage);
  } catch {
    /* storage blocked (private mode / SSR) */
  }
  return found;
}

function readRaw(): string | null {
  for (const storage of availableStorages()) {
    try {
      const value = storage.getItem(ONBOARDING_DRAFT_KEY);
      if (value) return value;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Persists the draft to both session and local storage.
 * Never throws — storage failures (quota, privacy mode) are silently ignored.
 */
export function saveDraft(draft: OnboardingDraft): void {
  const payload = JSON.stringify(draft);
  for (const storage of availableStorages()) {
    try {
      storage.setItem(ONBOARDING_DRAFT_KEY, payload);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Loads and self-heals the draft.
 *
 * @param currentFamilyId The signed-in user's current familyId, if known. When
 *   the user already belongs to a family the draft is stale and must never drive
 *   a second family creation, so it is cleared and `null` is returned. (The
 *   container also redirects such users away from onboarding.)
 *
 * Returns `null` when there is no draft, the draft is corrupt, the version is
 * wrong, or the user already has a family. A `null` result means "start fresh".
 */
export function loadDraft(currentFamilyId?: string | null): OnboardingDraft | null {
  const raw = readRaw();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft();
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: number }).version !== DRAFT_VERSION
  ) {
    clearDraft();
    return null;
  }

  // A matching post-auth draft is the durable continuation for a family this
  // journey already created. Any other draft belongs to an established-family
  // session and must never drive another creation.
  const parsedDraft = parsed as OnboardingDraft;
  const draft: OnboardingDraft = parsedDraft.firstChildRequestId && parsedDraft.firstTaskRequestId
    ? parsedDraft
    : {
        ...parsedDraft,
        firstChildRequestId: parsedDraft.firstChildRequestId || createOnboardingRequestId(),
        firstTaskRequestId: parsedDraft.firstTaskRequestId || createOnboardingRequestId(),
      };
  if (draft !== parsedDraft) saveDraft(draft);

  if (currentFamilyId) {
    if (POST_AUTH_STEPS.includes(draft.step) && draft.familyId === currentFamilyId) {
      return draft;
    }
    clearDraft();
    return null;
  }

  return draft;
}

/** Removes the draft from both storages. */
export function clearDraft(): void {
  for (const storage of availableStorages()) {
    try {
      storage.removeItem(ONBOARDING_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Merges a partial update into the persisted draft and returns the new draft,
 * or `null` if there was no draft to patch.
 */
export function patchDraft(partial: Partial<OnboardingDraft>): OnboardingDraft | null {
  const current = loadDraft();
  if (!current) return null;
  const next: OnboardingDraft = { ...current, ...partial, updatedAt: Date.now() };
  saveDraft(next);
  return next;
}
