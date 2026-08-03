/**
 * Dashboard Focus Mode (Phase 1).
 *
 * While a family's setup is incomplete, the Parent Dashboard suppresses all
 * non-essential widgets and shows a single guided next action. This module
 * holds the pure decision logic so it can be unit-tested and reused by both
 * the dashboard and the setup hub without duplicating onboarding systems.
 */

export type FocusStepKey = 'addChild' | 'pendingInvite' | 'createReward' | 'createTask';

/** Ordered guided setup steps. Progress is reported as "Step X of TOTAL_STEPS". */
export const FOCUS_STEPS: FocusStepKey[] = ['addChild', 'pendingInvite', 'createReward', 'createTask'];
export const TOTAL_FOCUS_STEPS = FOCUS_STEPS.length;

export interface FocusModeInput {
  familyMembers?: Array<{ role?: string }> | null;
  rewards?: unknown[] | null;
  tasks?: unknown[] | null;
  joinRequests?: Array<{ status?: string }> | null;
  currentUser?: { role?: string } | null;
}

export interface FocusModeState {
  /** True when the dashboard should hide non-essential sections. */
  isFocusMode: boolean;
  /** The single next action, or null when setup is complete. */
  step: FocusStepKey | null;
  /** Human readable progress position (1-based). 0 when complete. */
  stepNumber: number;
  totalSteps: number;
}

const isParentRole = (role?: string) => role === 'owner' || role === 'parent';

/**
 * Authoritative activation check (Sprint 1 specification).
 *
 * A family is activated once it has at least one other member (child or
 * parent), at least one reward and at least one task. Activated families must
 * never see onboarding surfaces on the Dashboard.
 *
 * Note: this is intentionally derived from real family data only — never from
 * account age, milestone flags or per-user overrides — so long-standing
 * families created before any milestone field existed are handled correctly.
 */
export function isFamilySetupComplete(input: FocusModeInput): boolean {
  const familyMembers = input.familyMembers ?? [];
  const rewards = input.rewards ?? [];
  const tasks = input.tasks ?? [];

  const hasChild = familyMembers.some(member => member?.role === 'child');
  const hasOtherMembers = familyMembers.length > 1;

  return (hasChild || hasOtherMembers) && rewards.length > 0 && tasks.length > 0;
}

export function getFocusModeState(input: FocusModeInput): FocusModeState {
  const familyMembers = input.familyMembers ?? [];
  const rewards = input.rewards ?? [];
  const tasks = input.tasks ?? [];
  const joinRequests = input.joinRequests ?? [];
  const currentUser = input.currentUser ?? null;

  const complete: FocusModeState = {
    isFocusMode: false,
    step: null,
    stepNumber: 0,
    totalSteps: TOTAL_FOCUS_STEPS,
  };

  // Only parents/owners are ever guided; children keep their own experience.
  if (!isParentRole(currentUser?.role)) return complete;

  // `familyMembers` always contains the owner once bootstrap has finished, so
  // an empty list means data is still loading — never flip into Focus Mode.
  if (familyMembers.length === 0) return complete;

  const hasChild = familyMembers.some(member => member?.role === 'child');
  const hasOtherMembers = familyMembers.length > 1;
  const hasPendingJoin = joinRequests.some(request => request?.status === 'pending');
  const hasRewards = rewards.length > 0;

  // Backward compatibility: an activated family never enters Focus Mode.
  if (isFamilySetupComplete({ familyMembers, rewards, tasks })) return complete;

  let step: FocusStepKey;
  if (hasPendingJoin) step = 'pendingInvite';
  else if (!hasChild && !hasOtherMembers) step = 'addChild';
  else if (!hasRewards) step = 'createReward';
  else step = 'createTask';

  return {
    isFocusMode: true,
    step,
    stepNumber: FOCUS_STEPS.indexOf(step) + 1,
    totalSteps: TOTAL_FOCUS_STEPS,
  };
}
