import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEmptyDraft,
  saveDraft,
  loadDraft,
  clearDraft,
  patchDraft,
  ONBOARDING_DRAFT_KEY,
  type OnboardingDraft,
} from './onboardingDraft';

function sampleDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    ...createEmptyDraft('s3'),
    parentFirstName: 'Kemal',
    childFirstName: 'Osman',
    familyName: 'Kemal Family',
    ...overrides,
  };
}

describe('onboardingDraft', () => {
  beforeEach(() => {
    clearDraft();
  });

  it('round-trips a saved draft through storage', () => {
    const draft = sampleDraft();
    saveDraft(draft);
    const loaded = loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.parentFirstName).toBe('Kemal');
    expect(loaded?.step).toBe('s3');
    expect(loaded?.version).toBe(1);
  });

  it('writes to both session and local storage (dual mirror)', () => {
    saveDraft(sampleDraft());
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).not.toBeNull();
    expect(localStorage.getItem(ONBOARDING_DRAFT_KEY)).not.toBeNull();
  });

  it('returns null when there is no draft', () => {
    expect(loadDraft()).toBeNull();
  });

  it('returns null and clears when the JSON is corrupt', () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, '{not valid json');
    expect(loadDraft()).toBeNull();
    // corrupt entry removed from both storages
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  });

  it('returns null and clears on version mismatch', () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ version: 99, step: 's1' }));
    expect(loadDraft()).toBeNull();
  });

  it('clears the draft from both storages', () => {
    saveDraft(sampleDraft());
    clearDraft();
    expect(loadDraft()).toBeNull();
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  });

  it('patchDraft merges and persists, returning the new draft', () => {
    saveDraft(sampleDraft({ parentFirstName: 'Kemal' }));
    const next = patchDraft({ familyName: 'Umutlu Family' });
    expect(next?.familyName).toBe('Umutlu Family');
    expect(next?.parentFirstName).toBe('Kemal');
    expect(loadDraft()?.familyName).toBe('Umutlu Family');
  });

  it('patchDraft returns null when there is no draft to patch', () => {
    expect(patchDraft({ familyName: 'x' })).toBeNull();
  });

  it('clears a stale draft when the current user already has a family', () => {
    saveDraft(sampleDraft());
    const loaded = loadDraft('family-existing-1');
    expect(loaded).toBeNull();
    expect(loadDraft()).toBeNull();
  });

  it('preserves a draft that already holds a familyId for idempotent resume', () => {
    // A draft with familyId must survive loadDraft() (no currentFamilyId) so a
    // refresh during post-auth setup can resume without recreating the family.
    saveDraft(sampleDraft({ familyId: 'family-1', childId: 'child-1' }));
    const loaded = loadDraft();
    expect(loaded?.familyId).toBe('family-1');
    expect(loaded?.childId).toBe('child-1');
  });

  it('preserves child and task request identities across a reload during finalization', () => {
    const draft = sampleDraft({
      step: 'p1',
      firstChildRequestId: 'onboarding-child-request-1',
      firstTaskRequestId: 'onboarding-task-request-1',
    });
    saveDraft(draft);

    const loaded = loadDraft();

    expect(loaded?.firstChildRequestId).toBe('onboarding-child-request-1');
    expect(loaded?.firstTaskRequestId).toBe('onboarding-task-request-1');
  });

  it('migrates an in-flight legacy draft to stable request identities once', () => {
    const legacy = sampleDraft() as Partial<OnboardingDraft>;
    delete legacy.firstChildRequestId;
    delete legacy.firstTaskRequestId;
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(legacy));

    const firstLoad = loadDraft();
    const secondLoad = loadDraft();

    expect(firstLoad?.firstChildRequestId).toBeTruthy();
    expect(firstLoad?.firstTaskRequestId).toBeTruthy();
    expect(secondLoad?.firstChildRequestId).toBe(firstLoad?.firstChildRequestId);
    expect(secondLoad?.firstTaskRequestId).toBe(firstLoad?.firstTaskRequestId);
  });

  it('loads a family-only draft without childFirstName cleanly', () => {
    const draft: OnboardingDraft = {
      version: 1,
      step: 's6',
      parentFirstName: 'Sarah',
      parentRoleDisplay: 'mother',
      familyName: 'The Smiths',
      updatedAt: Date.now(),
    };
    saveDraft(draft);

    const loaded = loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.parentFirstName).toBe('Sarah');
    expect(loaded?.childFirstName).toBeUndefined();
    expect(loaded?.step).toBe('s6');
  });

  it('normalizes legacy pre-auth step s4 to s6 on load', () => {
    sessionStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        version: 1,
        step: 's4',
        parentFirstName: 'Sarah',
        parentRoleDisplay: 'mother',
        childFirstName: 'OldChild',
        familyName: '',
        updatedAt: Date.now(),
      }),
    );

    const loaded = loadDraft();
    expect(loaded?.step).toBe('s6');
  });

  it('normalizes legacy post-auth step p2 to p1 on load', () => {
    sessionStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({
        version: 1,
        step: 'p2',
        parentFirstName: 'Sarah',
        parentRoleDisplay: 'mother',
        familyName: 'Smiths',
        familyId: 'fam-1',
        updatedAt: Date.now(),
      }),
    );

    const loaded = loadDraft('fam-1');
    expect(loaded?.step).toBe('p1');
  });
});
