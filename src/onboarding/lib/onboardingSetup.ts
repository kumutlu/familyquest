import type { OnboardingDraft } from './onboardingDraft';

/**
 * Authoritative post-auth setup orchestration.
 *
 * Every operation is "exactly-once" defended by (a) a client guard flag
 * persisted in the draft and (b) the existing server-side transaction/rule
 * guards in `createFamilyAndParent` / `createManagedMember` / `createTask`.
 *
 * Dependencies are injected so the module is unit-testable without Firebase.
 */

export interface FamilyCreationResult {
  familyId: string;
  inviteCode: string;
  user: { id: string; familyId?: string; role?: string };
}

export interface SetupDeps {
  /** Authoritative auth uid of the signed-in parent. */
  uid: string;
  createFamilyAndParent: (
    uid: string,
    name: string,
    familyName: string,
  ) => Promise<FamilyCreationResult>;
  createManagedMember: (
    familyId: string,
    role: 'parent' | 'child',
    displayName: string,
    profile?: { avatarId?: string | null; dob?: string | null; colour?: string | null },
    options?: { clientReqId?: string },
  ) => Promise<string>;
  createTask: (
    familyId: string,
    taskData: unknown,
    options?: { clientReqId?: string },
  ) => Promise<{ id: string }>;
  refreshCurrentUser: (uid: string, updated: { familyId: string; role: string }) => void;
  getFamilyMembers?: () => Array<{ id: string; displayName?: string; role?: string }>;
}

/**
 * Creates the family exactly once. If `draft.familyId` is already set (refresh,
 * retry, remount, or a second call) the server call is skipped entirely. In-flight
 * creations are deduplicated by uid so an async remount awaits the same promise
 * without duplicate writes. The authoritative family state is published to the
 * store via `refreshCurrentUser` using the authoritative uid — never a denormalised profile field.
 */
const inFlightFamilyCreation = new Map<string, Promise<FamilyCreationResult>>();

export async function ensureFamily(draft: OnboardingDraft, deps: SetupDeps): Promise<OnboardingDraft> {
  if (draft.familyId) return draft;

  let inFlight = inFlightFamilyCreation.get(deps.uid);
  if (!inFlight) {
    inFlight = deps.createFamilyAndParent(deps.uid, draft.parentFirstName, draft.familyName);
    inFlightFamilyCreation.set(deps.uid, inFlight);
  }

  try {
    const result = await inFlight;
    const familyId = result.user.familyId ?? result.familyId;
    deps.refreshCurrentUser(deps.uid, {
      familyId,
      role: result.user.role ?? 'owner',
    });
    return { ...draft, familyId };
  } finally {
    inFlightFamilyCreation.delete(deps.uid);
  }
}

/**
 * Creates the first managed child exactly once. Skipped when no child name was
 * provided or when `draft.childId` is already set. Retry identity is carried by
 * `firstChildRequestId`; names are never used as an identity boundary.
 */
export async function ensureFirstChild(draft: OnboardingDraft, deps: SetupDeps): Promise<OnboardingDraft> {
  if (draft.childId) return draft;
  if (!draft.familyId) throw new Error('Family must be created before the first child');
  const childName = draft.childFirstName?.trim() || '';
  if (!childName) return draft;
  if (!draft.firstChildRequestId) throw new Error('Onboarding child request identity is missing');

  const childId = await deps.createManagedMember(
    draft.familyId,
    'child',
    childName,
    undefined,
    { clientReqId: draft.firstChildRequestId },
  );
  return { ...draft, childId };
}

/**
 * Creates the first real task exactly once, assigned to the first child. Skipped
 * when `draft.firstTaskId` is already set.
 */
export async function ensureFirstTask(
  draft: OnboardingDraft,
  deps: SetupDeps,
  taskData: unknown,
): Promise<OnboardingDraft> {
  if (draft.firstTaskId) return draft;
  if (!draft.familyId) throw new Error('Family must be created before the first task');
  if (!draft.childId) throw new Error('A child must exist before assigning the first task');
  if (!draft.firstTaskRequestId) throw new Error('Onboarding task request identity is missing');

  const ref = await deps.createTask(
    draft.familyId,
    { ...(taskData as object), assigneeId: draft.childId },
    { clientReqId: draft.firstTaskRequestId },
  );
  return { ...draft, firstTaskId: ref.id };
}
