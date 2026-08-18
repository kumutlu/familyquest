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
  ) => Promise<string>;
  createTask: (familyId: string, taskData: unknown) => Promise<{ id: string }>;
  refreshCurrentUser: (uid: string, updated: { familyId: string; role: string }) => void;
  /** Optional: current family members, used to skip a duplicate first child. */
  getFamilyMembers?: () => Array<{ id: string; displayName?: string; role?: string }>;
}

/**
 * Creates the family exactly once. If `draft.familyId` is already set (refresh,
 * retry, remount, or a second call) the server call is skipped entirely. The
 * authoritative family state is published to the store via `refreshCurrentUser`
 * using the authoritative uid — never a denormalised profile field.
 */
export async function ensureFamily(draft: OnboardingDraft, deps: SetupDeps): Promise<OnboardingDraft> {
  if (draft.familyId) return draft;

  const result = await deps.createFamilyAndParent(deps.uid, draft.parentFirstName, draft.familyName);
  const familyId = result.user.familyId ?? result.familyId;
  deps.refreshCurrentUser(deps.uid, {
    familyId,
    role: result.user.role ?? 'owner',
  });
  return { ...draft, familyId };
}

/**
 * Creates the first managed child exactly once. Skipped when no child name was
 * provided, when the child already exists (name match against current members),
 * or when `draft.childId` is already set.
 */
export async function ensureFirstChild(draft: OnboardingDraft, deps: SetupDeps): Promise<OnboardingDraft> {
  if (draft.childId) return draft;
  if (!draft.familyId) throw new Error('Family must be created before the first child');
  const childName = draft.childFirstName.trim();
  if (!childName) return draft;

  const members = deps.getFamilyMembers?.() ?? [];
  const alreadyExists = members.some(
    m => m.role === 'child' && m.displayName?.trim().toLowerCase() === childName.toLowerCase(),
  );
  if (alreadyExists) return draft;

  const childId = await deps.createManagedMember(draft.familyId, 'child', childName);
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

  const ref = await deps.createTask(draft.familyId, { ...(taskData as object), assigneeId: draft.childId });
  return { ...draft, firstTaskId: ref.id };
}
