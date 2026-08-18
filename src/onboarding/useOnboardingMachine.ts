import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEmptyDraft,
  loadDraft,
  saveDraft,
  clearDraft,
  type OnboardingDraft,
  type Step,
  PRE_AUTH_STEPS,
  POST_AUTH_STEPS,
} from './lib/onboardingDraft';

export type { OnboardingDraft, Step } from './lib/onboardingDraft';

export type MachineAction =
  | { type: 'goNext' }
  | { type: 'goBack' }
  | { type: 'setStep'; step: Step }
  | { type: 'patch'; partial: Partial<OnboardingDraft> }
  | { type: 'reset' };

/** Pure transition: advance within the current phase only (never crosses the
 *  pre-auth → post-auth boundary, which is driven by auth completion). */
export function nextStep(step: Step): Step {
  const preIndex = PRE_AUTH_STEPS.indexOf(step);
  if (preIndex >= 0 && preIndex < PRE_AUTH_STEPS.length - 1) {
    return PRE_AUTH_STEPS[preIndex + 1];
  }
  const postIndex = POST_AUTH_STEPS.indexOf(step);
  if (postIndex >= 0 && postIndex < POST_AUTH_STEPS.length - 1) {
    return POST_AUTH_STEPS[postIndex + 1];
  }
  return step;
}

/** Pure transition: go back within the current phase only. */
export function prevStep(step: Step): Step {
  const preIndex = PRE_AUTH_STEPS.indexOf(step);
  if (preIndex > 0) return PRE_AUTH_STEPS[preIndex - 1];
  const postIndex = POST_AUTH_STEPS.indexOf(step);
  if (postIndex > 0) return POST_AUTH_STEPS[postIndex - 1];
  return step;
}

/** Pure reducer — fully testable without React. */
export function reduceDraft(draft: OnboardingDraft, action: MachineAction): OnboardingDraft {
  switch (action.type) {
    case 'goNext':
      return { ...draft, step: nextStep(draft.step), updatedAt: Date.now() };
    case 'goBack':
      return { ...draft, step: prevStep(draft.step), updatedAt: Date.now() };
    case 'setStep':
      return { ...draft, step: action.step, updatedAt: Date.now() };
    case 'patch':
      return { ...draft, ...action.partial, updatedAt: Date.now() };
    case 'reset':
      return createEmptyDraft('s1');
    default:
      return draft;
  }
}

export interface OnboardingMachine {
  draft: OnboardingDraft;
  goNext: () => void;
  goBack: () => void;
  setStep: (step: Step) => void;
  patch: (partial: Partial<OnboardingDraft>) => void;
  reset: () => void;
}

/**
 * React hook wrapping the pure reducer. The draft is persisted to storage on
 * every change so a refresh / provider redirect resumes exactly where the user
 * left off. `currentFamilyId` is forwarded to `loadDraft` so an established
 * family owner never resumes a stale draft.
 */
export function useOnboardingMachine(currentFamilyId?: string | null): OnboardingMachine {
  const [draft, setDraft] = useState<OnboardingDraft>(() => {
    const restored = loadDraft(currentFamilyId);
    return restored ?? createEmptyDraft('s1');
  });

  // Persist on every change. Skip the very first render when nothing changed.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      // Still persist the initial (possibly restored) draft so `updatedAt` is fresh.
    }
    saveDraft(draft);
  }, [draft]);

  const goNext = useCallback(() => setDraft(d => reduceDraft(d, { type: 'goNext' })), []);
  const goBack = useCallback(() => setDraft(d => reduceDraft(d, { type: 'goBack' })), []);
  const setStep = useCallback((step: Step) => setDraft(d => reduceDraft(d, { type: 'setStep', step })), []);
  const patch = useCallback(
    (partial: Partial<OnboardingDraft>) => setDraft(d => reduceDraft(d, { type: 'patch', partial })),
    [],
  );
  const reset = useCallback(() => {
    clearDraft();
    setDraft(createEmptyDraft('s1'));
  }, []);

  return { draft, goNext, goBack, setStep, patch, reset };
}
