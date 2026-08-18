import { describe, expect, it } from 'vitest';
import {
  reduceDraft,
  nextStep,
  prevStep,
  type OnboardingDraft,
} from './useOnboardingMachine';
import { createEmptyDraft } from './lib/onboardingDraft';

function draft(step: OnboardingDraft['step']): OnboardingDraft {
  return { ...createEmptyDraft(step) };
}

describe('useOnboardingMachine (pure reducer)', () => {
  it('advances forward within the pre-auth phase only', () => {
    expect(nextStep('s1')).toBe('s2');
    expect(nextStep('s6')).toBe('s7');
    // never crosses into post-auth
    expect(nextStep('s7')).toBe('s7');
  });

  it('advances forward within the post-auth phase only', () => {
    expect(nextStep('p1')).toBe('p2');
    expect(nextStep('p2')).toBe('p3');
    expect(nextStep('p3')).toBe('p3');
  });

  it('goes back within the same phase only', () => {
    expect(prevStep('s3')).toBe('s2');
    expect(prevStep('s1')).toBe('s1');
    expect(prevStep('p2')).toBe('p1');
    expect(prevStep('p1')).toBe('p1');
  });

  it('goNext / goBack update the step and bump updatedAt', () => {
    const start = draft('s1');
    const after = reduceDraft(start, { type: 'goNext' });
    expect(after.step).toBe('s2');
    expect(after.updatedAt).toBeGreaterThanOrEqual(start.updatedAt);
  });

  it('patch preserves existing values and merges the partial', () => {
    const start = draft('s2');
    const after = reduceDraft(start, { type: 'patch', partial: { parentFirstName: 'Kemal' } });
    expect(after.parentFirstName).toBe('Kemal');
    expect(after.step).toBe('s2');
    // back navigation never loses patched data
    const back = reduceDraft(after, { type: 'goBack' });
    expect(back.parentFirstName).toBe('Kemal');
  });

  it('setStep jumps to an explicit step', () => {
    const after = reduceDraft(draft('s7'), { type: 'setStep', step: 'p1' });
    expect(after.step).toBe('p1');
  });

  it('reset returns a fresh s1 draft', () => {
    const after = reduceDraft(draft('p3'), { type: 'reset' });
    expect(after.step).toBe('s1');
    expect(after.parentFirstName).toBe('');
  });
});
