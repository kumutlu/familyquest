import { describe, expect, it } from 'vitest';
import { shouldShowFamilySetupPrompt } from './familySetup';

const ready = {
  appReady: true,
  familyLoading: false,
  familyData: { id: 'family-1' },
  familyMembers: [{ id: 'owner-1', role: 'owner' }],
  currentUser: { uid: 'owner-1', role: 'owner', familyId: 'family-1' },
  bootstrapStatus: { family: 'ready', members: 'ready' },
};

describe('family setup prompt gate', () => {
  it.each([
    ['app bootstrap', { appReady: false }],
    ['family document', { familyData: null }],
    ['family loading', { familyLoading: true }],
    ['members subscription', { bootstrapStatus: { family: 'ready', members: 'loading' } }],
  ])('waits for authoritative %s data', (_name, override) => {
    expect(shouldShowFamilySetupPrompt({ ...ready, ...override } as any)).toBe(false);
  });

  it('shows for an owner when authoritative setup is incomplete', () => {
    expect(shouldShowFamilySetupPrompt(ready as any)).toBe(true);
  });

  it('does not show after persisted completion or for non-owners', () => {
    expect(shouldShowFamilySetupPrompt({
      ...ready,
      familyData: { ...ready.familyData, setup: { welcomePromptCompleted: true } },
    } as any)).toBe(false);
    expect(shouldShowFamilySetupPrompt({
      ...ready,
      currentUser: { ...ready.currentUser, role: 'parent' },
    } as any)).toBe(false);
  });
});
