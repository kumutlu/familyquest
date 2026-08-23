import { describe, it, expect } from 'vitest';
import { createCompletionMachine } from './completionMachine';

function machine(status?: string | null) {
  return createCompletionMachine({ authoritativeStatus: status ?? null });
}

describe('completion state machine', () => {
  it('starts idle for an available quest', () => {
    expect(machine(null).state).toBe('idle');
  });

  it('adopts the authoritative pending state immediately (reload survival)', () => {
    expect(machine('pending_approval').state).toBe('pending');
  });

  it('adopts the authoritative approved state', () => {
    expect(machine('approved').state).toBe('confirmed');
  });

  it('treats an authoritative rejected state as retryable', () => {
    const m = machine('rejected');
    expect(m.state).toBe('retry');
    expect(m.canSubmit).toBe(true);
  });

  it('walks idle → holding → submitting → pending on success', () => {
    let m = machine(null);
    m = m.reduce({ type: 'HOLD_START' });
    expect(m.state).toBe('holding');
    m = m.reduce({ type: 'HOLD_COMPLETE' });
    expect(m.state).toBe('submitting');
    m = m.reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    expect(m.state).toBe('pending');
    expect(m.canSubmit).toBe(false);
  });

  it('rejects HOLD_START while not idle or retrying', () => {
    let m = machine(null).reduce({ type: 'HOLD_START' }).reduce({ type: 'HOLD_COMPLETE' });
    const before = m;
    m = m.reduce({ type: 'HOLD_START' });
    expect(m).toBe(before); // same object — event ignored
  });

  it('cancels a hold cleanly back to idle', () => {
    const m = machine(null)
      .reduce({ type: 'HOLD_START' })
      .reduce({ type: 'HOLD_CANCEL' });
    expect(m.state).toBe('idle');
    expect(m.holdProgress).toBe(0);
  });

  it('returns to idle with an error message on submit failure', () => {
    const m = machine(null)
      .reduce({ type: 'HOLD_START' })
      .reduce({ type: 'HOLD_COMPLETE' })
      .reduce({ type: 'SUBMIT_FAILED', message: 'Network unreachable' });
    expect(m.state).toBe('error');
    expect(m.message).toBe('Network unreachable');
    expect(m.canSubmit).toBe(true); // retry allowed
  });

  it('ignores SUBMIT_RESOLVED when not submitting (duplicate protection)', () => {
    let m = machine(null).reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    // Not submitting → event must be ignored entirely.
    expect(m.state).toBe('idle');
    m = machine('pending_approval').reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    expect(m.state).toBe('pending');
  });

  it('syncs to confirmed only from authoritative data', () => {
    let m = machine(null).reduce({ type: 'COMPLETE_NOW' }).reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    expect(m.state).toBe('pending');
    m = m.reduce({ type: 'SYNC', status: 'approved' });
    expect(m.state).toBe('confirmed');
  });

  it('syncs to retry when the parent rejects', () => {
    let m = machine(null).reduce({ type: 'COMPLETE_NOW' }).reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    m = m.reduce({ type: 'SYNC', status: 'rejected', parentComment: 'Try again' });
    expect(m.state).toBe('retry');
    expect(m.parentComment).toBe('Try again');
    expect(m.canSubmit).toBe(true);
  });

  it('does not downgrade confirmed state on a stale sync', () => {
    let m = machine(null).reduce({ type: 'SYNC', status: 'approved' });
    m = m.reduce({ type: 'SYNC', status: 'pending_approval' });
    expect(m.state).toBe('confirmed');
  });

  it('keeps submitting through listener updates (no mid-flight downgrade)', () => {
    let m = machine(null).reduce({ type: 'HOLD_START' }).reduce({ type: 'HOLD_COMPLETE' });
    m = m.reduce({ type: 'SYNC', status: null });
    expect(m.state).toBe('submitting');
  });

  it('supports keyboard completion via COMPLETE_NOW', () => {
    let m = machine(null).reduce({ type: 'COMPLETE_NOW' });
    expect(m.state).toBe('submitting');
    m = m.reduce({ type: 'SUBMIT_RESOLVED', outcome: 'pending' });
    expect(m.state).toBe('pending');
  });

  it('auto-approved quests confirm immediately without a pending phase', () => {
    let m = machine(null).reduce({ type: 'COMPLETE_NOW' });
    m = m.reduce({ type: 'SUBMIT_RESOLVED', outcome: 'approved' });
    expect(m.state).toBe('confirmed');
  });

  it('reset returns from error to idle', () => {
    const m = machine(null)
      .reduce({ type: 'COMPLETE_NOW' })
      .reduce({ type: 'SUBMIT_FAILED', message: 'boom' })
      .reduce({ type: 'RESET' });
    expect(m.state).toBe('idle');
    expect(m.message).toBeNull();
  });
});
