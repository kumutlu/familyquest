import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  childOnboardingStepKey,
  clearChildOnboardingStep,
  countChildren,
  loadChildOnboardingStep,
  saveChildOnboardingStep,
  shouldStartChildOnboarding,
} from './childOnboarding';

const parent = { uid: 'p1', familyId: 'fam1', role: 'parent' };

describe('childOnboarding helper', () => {
  describe('countChildren', () => {
    it('counts only child-role members', () => {
      const members = [
        { id: 'a', role: 'parent' },
        { id: 'b', role: 'child' },
        { id: 'c', role: 'child' },
        { id: 'd', role: 'owner' },
      ];
      expect(countChildren(members)).toBe(2);
    });

    it('returns 0 for an empty list', () => {
      expect(countChildren([])).toBe(0);
      expect(countChildren(undefined as any)).toBe(0);
    });
  });

  describe('shouldStartChildOnboarding', () => {
    it('starts when authenticated, in a family, with zero children (first login with zero children)', () => {
      expect(
        shouldStartChildOnboarding({
          currentUser: parent,
          familyMembers: [{ id: 'a', role: 'parent' }],
          appReady: true,
          pathname: '/dashboard',
        }),
      ).toBe(true);
    });

    it('does NOT start when the family already has children (existing family with children)', () => {
      expect(
        shouldStartChildOnboarding({
          currentUser: parent,
          familyMembers: [{ id: 'a', role: 'parent' }, { id: 'b', role: 'child' }],
          appReady: true,
          pathname: '/dashboard',
        }),
      ).toBe(false);
    });

    it('does NOT start before bootstrap is ready', () => {
      expect(
        shouldStartChildOnboarding({
          currentUser: parent,
          familyMembers: [],
          appReady: false,
          pathname: '/dashboard',
        }),
      ).toBe(false);
    });

    it('does NOT start when the user has no family', () => {
      expect(
        shouldStartChildOnboarding({
          currentUser: { uid: 'p1', familyId: null, role: 'parent' },
          familyMembers: [],
          appReady: true,
          pathname: '/dashboard',
        }),
      ).toBe(false);
    });

    it('does NOT start while already on the onboarding route (no redirect loop)', () => {
      expect(
        shouldStartChildOnboarding({
          currentUser: parent,
          familyMembers: [],
          appReady: true,
          pathname: '/child-onboarding',
        }),
      ).toBe(false);
    });
  });

  describe('step persistence (resume after refresh)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('defaults to step 1 when nothing is stored', () => {
      expect(loadChildOnboardingStep('fam1')).toBe(1);
    });

    it('saves and reloads the current step', () => {
      saveChildOnboardingStep('fam1', 4);
      expect(loadChildOnboardingStep('fam1')).toBe(4);
    });

    it('clears the persisted step', () => {
      saveChildOnboardingStep('fam1', 3);
      clearChildOnboardingStep('fam1');
      expect(loadChildOnboardingStep('fam1')).toBe(1);
    });

    it('is a no-op without a familyId', () => {
      expect(childOnboardingStepKey(null)).toBeNull();
      saveChildOnboardingStep(null, 5);
      expect(loadChildOnboardingStep(null)).toBe(1);
    });
  });
});
