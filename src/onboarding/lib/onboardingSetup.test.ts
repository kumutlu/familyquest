import { describe, expect, it, vi } from 'vitest';
import { ensureFamily, ensureFirstChild, ensureFirstTask, type SetupDeps } from './onboardingSetup';
import { createEmptyDraft, type OnboardingDraft } from './onboardingDraft';

function makeDeps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    uid: 'auth-uid-1',
    createFamilyAndParent: vi.fn().mockResolvedValue({
      familyId: 'family-1',
      inviteCode: 'ABC123',
      user: { id: 'auth-uid-1', familyId: 'family-1', role: 'owner' },
    }),
    createManagedMember: vi.fn().mockResolvedValue('child-1'),
    createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
    refreshCurrentUser: vi.fn(),
    getFamilyMembers: () => [],
    ...overrides,
  };
}

describe('onboardingSetup idempotency', () => {
  it('creates the family exactly once across a refresh/retry', async () => {
    const deps = makeDeps();
    const base = createEmptyDraft('p1');

    const first = await ensureFamily(base, deps);
    const second = await ensureFamily(first, deps); // simulate retry/refresh

    expect(deps.createFamilyAndParent).toHaveBeenCalledTimes(1);
    expect(first.familyId).toBe('family-1');
    expect(second.familyId).toBe('family-1');
    // authoritative uid used, never a denormalised field
    expect(deps.createFamilyAndParent).toHaveBeenCalledWith('auth-uid-1', '', '');
    expect(deps.refreshCurrentUser).toHaveBeenCalledWith('auth-uid-1', {
      familyId: 'family-1',
      role: 'owner',
    });
  });

  it('skips family creation when familyId is already present', async () => {
    const deps = makeDeps();
    const withFamily: OnboardingDraft = { ...createEmptyDraft('p1'), familyId: 'family-1' };
    const result = await ensureFamily(withFamily, deps);
    expect(deps.createFamilyAndParent).not.toHaveBeenCalled();
    expect(result.familyId).toBe('family-1');
  });

  it('creates the first child exactly once and skips when name matches', async () => {
    const deps = makeDeps();
    const withFamily: OnboardingDraft = {
      ...createEmptyDraft('p1'),
      familyId: 'family-1',
      childFirstName: 'Osman',
    };

    const first = await ensureFirstChild(withFamily, deps);
    const second = await ensureFirstChild(first, deps);
    expect(deps.createManagedMember).toHaveBeenCalledTimes(1);
    expect(first.childId).toBe('child-1');
    // Idempotent: the replay reuses the existing child rather than creating a second.
    expect(second.childId).toBe('child-1');

    // A member with the same display name already present → no duplicate.
    const deps2 = makeDeps({ getFamilyMembers: () => [{ id: 'x', displayName: 'Osman', role: 'child' }] });
    const skipped = await ensureFirstChild(withFamily, deps2);
    expect(deps2.createManagedMember).not.toHaveBeenCalled();
    expect(skipped.childId).toBeUndefined();
  });

  it('does not create a child when no name was provided', async () => {
    const deps = makeDeps();
    const withFamily: OnboardingDraft = { ...createEmptyDraft('p1'), familyId: 'family-1' };
    const result = await ensureFirstChild(withFamily, deps);
    expect(deps.createManagedMember).not.toHaveBeenCalled();
    expect(result.childId).toBeUndefined();
  });

  it('creates the first task exactly once, assigned to the child', async () => {
    const deps = makeDeps();
    const ready: OnboardingDraft = {
      ...createEmptyDraft('p2'),
      familyId: 'family-1',
      childId: 'child-1',
    };

    const first = await ensureFirstTask(ready, deps, { title: 'Tidy bedroom', pointsReward: 20 });
    const second = await ensureFirstTask(first, deps, { title: 'Tidy bedroom', pointsReward: 20 });
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    expect(deps.createTask).toHaveBeenCalledWith('family-1', {
      title: 'Tidy bedroom',
      pointsReward: 20,
      assigneeId: 'child-1',
    });
    expect(first.firstTaskId).toBe('task-1');
    expect(second.firstTaskId).toBe('task-1');
  });

  it('skips task creation when firstTaskId is already present', async () => {
    const deps = makeDeps();
    const ready: OnboardingDraft = {
      ...createEmptyDraft('p2'),
      familyId: 'family-1',
      childId: 'child-1',
      firstTaskId: 'task-1',
    };
    await ensureFirstTask(ready, deps, { title: 'x' });
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('throws if task is attempted before the family/child exist', async () => {
    const deps = makeDeps();
    const incomplete: OnboardingDraft = { ...createEmptyDraft('p2'), familyId: 'family-1' };
    await expect(ensureFirstTask(incomplete, deps, { title: 'x' })).rejects.toThrow();
  });
});
