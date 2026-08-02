import { describe, it, expect } from 'vitest';
import { getFocusModeState, TOTAL_FOCUS_STEPS } from './focusMode';

const owner = { role: 'owner' };
const child = { role: 'child' };

describe('getFocusModeState', () => {
  it('activates focus mode with the add-child step for a brand new family', () => {
    const state = getFocusModeState({ familyMembers: [owner], currentUser: owner });
    expect(state.isFocusMode).toBe(true);
    expect(state.step).toBe('addChild');
    expect(state.stepNumber).toBe(1);
    expect(state.totalSteps).toBe(TOTAL_FOCUS_STEPS);
  });

  it('prioritises a pending invitation over every other step', () => {
    const state = getFocusModeState({
      familyMembers: [owner],
      joinRequests: [{ status: 'pending' }],
      currentUser: owner,
    });
    expect(state.step).toBe('pendingInvite');
    expect(state.stepNumber).toBe(2);
  });

  it('asks for a reward once a child exists', () => {
    const state = getFocusModeState({ familyMembers: [owner, child], currentUser: owner });
    expect(state.step).toBe('createReward');
    expect(state.stepNumber).toBe(3);
  });

  it('asks for a task once a reward exists', () => {
    const state = getFocusModeState({
      familyMembers: [owner, child],
      rewards: [{ id: 'r1' }],
      currentUser: owner,
    });
    expect(state.step).toBe('createTask');
    expect(state.stepNumber).toBe(4);
  });

  it('exits focus mode automatically when setup is complete', () => {
    const state = getFocusModeState({
      familyMembers: [owner, child],
      rewards: [{ id: 'r1' }],
      tasks: [{ id: 't1' }],
      currentUser: owner,
    });
    expect(state.isFocusMode).toBe(false);
    expect(state.step).toBeNull();
  });

  it('never enters focus mode for children', () => {
    expect(getFocusModeState({ familyMembers: [child], currentUser: child }).isFocusMode).toBe(false);
  });

  it('never enters focus mode while family data is still loading', () => {
    expect(getFocusModeState({ familyMembers: [], currentUser: owner }).isFocusMode).toBe(false);
  });
});
