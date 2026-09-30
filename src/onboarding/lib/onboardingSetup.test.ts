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

  });

  it('never merges a legitimate sibling merely because the display name matches', async () => {
    const deps = makeDeps({
      getFamilyMembers: () => [{ id: 'existing-child', displayName: 'Alex', role: 'child' }],
      createManagedMember: vi.fn().mockResolvedValue('new-child'),
    });
    const draft: OnboardingDraft = {
      ...createEmptyDraft('p1'),
      familyId: 'family-1',
      childFirstName: 'Alex',
      firstChildRequestId: 'onboarding-child-request-2',
    };

    const result = await ensureFirstChild(draft, deps);

    expect(deps.createManagedMember).toHaveBeenCalledTimes(1);
    expect(result.childId).toBe('new-child');
  });

  it('creates one managed child when the same onboarding finalization runs concurrently', async () => {
    let releaseFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    let call = 0;
    const childrenByRequest = new Map<string, string>();
    const createManagedMember = vi.fn(async (...args: unknown[]) => {
      call += 1;
      if (call === 1) {
        await firstWriteStarted;
      }
      const requestId = (args[4] as { clientReqId?: string } | undefined)?.clientReqId;
      if (!requestId) return `child-${call}`;
      const existing = childrenByRequest.get(requestId);
      if (existing) return existing;
      const childId = `child-${childrenByRequest.size + 1}`;
      childrenByRequest.set(requestId, childId);
      return childId;
    });
    const deps = makeDeps({ createManagedMember });
    const withFamily: OnboardingDraft = {
      ...createEmptyDraft('p1'),
      familyId: 'family-1',
      childFirstName: 'Osman',
      firstChildRequestId: 'onboarding-child-request-1',
    };

    const first = ensureFirstChild(withFamily, deps);
    const second = ensureFirstChild(withFamily, deps);
    releaseFirstWrite();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(createManagedMember).toHaveBeenCalledTimes(2);
    expect(createManagedMember.mock.calls[0]?.[4]).toEqual({ clientReqId: 'onboarding-child-request-1' });
    expect(createManagedMember.mock.calls[1]?.[4]).toEqual({ clientReqId: 'onboarding-child-request-1' });
    expect(firstResult.childId).toBe('child-1');
    expect(secondResult.childId).toBe('child-1');
  });

  it('does not merge genuinely different onboarding child identities', async () => {
    const createManagedMember = vi.fn(async (...args: unknown[]) => {
      const requestId = (args[4] as { clientReqId?: string } | undefined)?.clientReqId;
      return requestId === 'onboarding-child-request-1' ? 'child-1' : 'child-2';
    });
    const deps = makeDeps({ createManagedMember });
    const base = {
      ...createEmptyDraft('p1'),
      familyId: 'family-1',
      childFirstName: 'Alex',
    };

    const [first, second] = await Promise.all([
      ensureFirstChild({ ...base, firstChildRequestId: 'onboarding-child-request-1' }, deps),
      ensureFirstChild({ ...base, firstChildRequestId: 'onboarding-child-request-2' }, deps),
    ]);

    expect(first.childId).toBe('child-1');
    expect(second.childId).toBe('child-2');
  });

  it('reuses the same child request identity after a transient finalization failure', async () => {
    const seenRequestIds: Array<string | undefined> = [];
    const createManagedMember = vi.fn(async (...args: unknown[]) => {
      const requestId = (args[4] as { clientReqId?: string } | undefined)?.clientReqId;
      seenRequestIds.push(requestId);
      if (seenRequestIds.length === 1) throw new Error('transient');
      return 'child-1';
    });
    const deps = makeDeps({ createManagedMember });
    const draft: OnboardingDraft = {
      ...createEmptyDraft('p1'),
      familyId: 'family-1',
      childFirstName: 'Osman',
      firstChildRequestId: 'onboarding-child-request-1',
    };

    await expect(ensureFirstChild(draft, deps)).rejects.toThrow('transient');
    const retried = await ensureFirstChild(draft, deps);

    expect(seenRequestIds).toEqual([
      'onboarding-child-request-1',
      'onboarding-child-request-1',
    ]);
    expect(retried.childId).toBe('child-1');
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
    expect(deps.createTask).toHaveBeenCalledWith(
      'family-1',
      {
        title: 'Tidy bedroom',
        pointsReward: 20,
        assigneeId: 'child-1',
      },
      { clientReqId: ready.firstTaskRequestId },
    );
    expect(first.firstTaskId).toBe('task-1');
    expect(second.firstTaskId).toBe('task-1');
  });

  it('uses one stable identity when initial task creation runs concurrently', async () => {
    const tasksByRequest = new Map<string, string>();
    const createTask = vi.fn(async (_familyId: string, _task: unknown, options?: { clientReqId?: string }) => {
      const requestId = options?.clientReqId;
      if (!requestId) return { id: `task-${tasksByRequest.size + 1}` };
      const existing = tasksByRequest.get(requestId);
      if (existing) return { id: existing };
      const taskId = `task-${tasksByRequest.size + 1}`;
      tasksByRequest.set(requestId, taskId);
      return { id: taskId };
    });
    const deps = makeDeps({ createTask });
    const ready: OnboardingDraft = {
      ...createEmptyDraft('p2'),
      familyId: 'family-1',
      childId: 'child-1',
      firstTaskRequestId: 'onboarding-task-request-1',
    };

    const [first, second] = await Promise.all([
      ensureFirstTask(ready, deps, { title: 'Tidy bedroom' }),
      ensureFirstTask(ready, deps, { title: 'Tidy bedroom' }),
    ]);

    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[0]?.[2]).toEqual({ clientReqId: 'onboarding-task-request-1' });
    expect(createTask.mock.calls[1]?.[2]).toEqual({ clientReqId: 'onboarding-task-request-1' });
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
