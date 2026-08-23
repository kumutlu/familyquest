/**
 * Quest completion interaction state machine — Queki v2 Wave 2.
 *
 * A pure, testable reducer that models the UI lifecycle of ONE quest
 * completion without replacing the backend lifecycle:
 *
 *   idle → holding → submitting → pending ──(SYNC approved)──▶ confirmed
 *     ▲                    │                └─(SYNC rejected)─▶ retry
 *     └──── HOLD_CANCEL ───┘
 *   submitting ─(SUBMIT_FAILED)─▶ error ─(retry)─▶ submitting
 *
 * Invariants enforced here (unit-tested):
 *  - completion fires exactly once (submitting is terminal for SUBMIT events);
 *  - pending can never resubmit (canSubmit false);
 *  - authoritative SYNC always wins over local optimism EXCEPT mid-flight;
 *  - confirmed never downgrades to pending/rejected via stale sync.
 */

export type CompletionState =
  | 'idle'
  | 'holding'
  | 'submitting'
  | 'pending'
  | 'confirmed'
  | 'retry'
  | 'error';

export interface CompletionMachineModel {
  state: CompletionState;
  /** 0–1 hold fill progress (visual only; the machine does not tick it). */
  holdProgress: number;
  message: string | null;
  parentComment?: string | null;
  canSubmit: boolean;
}

export type CompletionEvent =
  | { type: 'HOLD_START' }
  | { type: 'HOLD_PROGRESS'; progress: number }
  | { type: 'HOLD_CANCEL' }
  | { type: 'HOLD_COMPLETE' }
  /** Accessible/keyboard path straight to submission. */
  | { type: 'COMPLETE_NOW' }
  | { type: 'SUBMIT_RESOLVED'; outcome: 'pending' | 'approved' }
  | { type: 'SUBMIT_FAILED'; message: string }
  /** Authoritative Firestore status observed by a listener. */
  | { type: 'SYNC'; status: string | null | undefined; parentComment?: string | null }
  | { type: 'RESET' };

const BASE: CompletionMachineModel = {
  state: 'idle',
  holdProgress: 0,
  message: null,
  parentComment: null,
  canSubmit: true,
};

type Machine = CompletionMachineModel & {
  /** Pure: returns a NEW machine; the current one is never mutated. */
  reduce: (event: CompletionEvent) => Machine;
};

/** Wrap a plain model so every `.reduce()` yields a new chainable machine.
 *  Ignored events return the SAME machine instance (identity-stable no-op). */
function withReduce(model: CompletionMachineModel): Machine {
  const wrapped: Machine = {
    ...model,
    reduce: (event: CompletionEvent) => {
      const next = reduce(model, event);
      return next === model ? wrapped : withReduce(next);
    },
  };
  return wrapped;
}

export function createCompletionMachine(input: {
  authoritativeStatus: string | null | undefined;
  parentComment?: string | null;
}): Machine {
  return withReduce(applySync(BASE, input.authoritativeStatus, input.parentComment));
}

/** Map an authoritative domain status onto a UI state. */
function applySync(
  model: CompletionMachineModel,
  status: string | null | undefined,
  parentComment?: string | null,
): CompletionMachineModel {
  switch (status) {
    case 'pending_approval':
      return { ...model, state: 'pending', holdProgress: 0, canSubmit: false, parentComment: null };
    case 'approved':
      return { ...model, state: 'confirmed', holdProgress: 0, canSubmit: false, parentComment: null };
    case 'rejected':
      return {
        ...model,
        state: 'retry',
        holdProgress: 0,
        canSubmit: true,
        parentComment: parentComment ?? model.parentComment,
      };
    default:
      // No authoritative record (or archived attempt) → available.
      return { ...BASE, parentComment: null };
  }
}

const CONFIRMED_RANK = 3;

function stateRank(state: CompletionState): number {
  switch (state) {
    case 'confirmed': return CONFIRMED_RANK;
    case 'pending': return 2;
    default: return 0;
  }
}

export function reduce(model: CompletionMachineModel, event: CompletionEvent): CompletionMachineModel {
  switch (event.type) {
    case 'HOLD_START':
      if (model.state !== 'idle' && model.state !== 'retry' && model.state !== 'error') return model;
      return { ...model, state: 'holding', holdProgress: 0, message: null };

    case 'HOLD_PROGRESS':
      if (model.state !== 'holding') return model;
      return { ...model, holdProgress: Math.min(1, Math.max(0, event.progress)) };

    case 'HOLD_CANCEL':
      if (model.state !== 'holding') return model;
      return { ...model, state: 'idle', holdProgress: 0 };

    case 'HOLD_COMPLETE':
      if (model.state !== 'holding') return model;
      return { ...model, state: 'submitting', holdProgress: 1 };

    case 'COMPLETE_NOW':
      if (model.state !== 'idle' && model.state !== 'retry' && model.state !== 'error') return model;
      return { ...model, state: 'submitting', holdProgress: 0, message: null };

    case 'SUBMIT_RESOLVED':
      if (model.state !== 'submitting') return model; // duplicate protection
      return event.outcome === 'approved'
        ? { ...model, state: 'confirmed', holdProgress: 0, canSubmit: false }
        : { ...model, state: 'pending', holdProgress: 0, canSubmit: false };

    case 'SUBMIT_FAILED':
      if (model.state !== 'submitting') return model;
      return { ...model, state: 'error', holdProgress: 0, canSubmit: true, message: event.message };

    case 'SYNC': {
      // Mid-flight submission: never downgrade on a listener blip.
      if (model.state === 'submitting') return model;
      // Confirmed is terminal — stale snapshots may not undo it.
      if (
        model.state === 'confirmed' &&
        stateRank('confirmed') > rankOfStatus(event.status)
      ) {
        return model;
      }
      const next = applySync(model, event.status, event.parentComment);
      // Identity-stable no-op when the authoritative status changes nothing —
      // prevents listener-driven re-render loops.
      if (
        next.state === model.state &&
        next.canSubmit === model.canSubmit &&
        next.parentComment === model.parentComment
      ) {
        return model;
      }
      return next;
    }

    case 'RESET':
      return { ...BASE };
  }
}

function rankOfStatus(status: string | null | undefined): number {
  if (status === 'approved') return CONFIRMED_RANK;
  if (status === 'pending_approval') return 2;
  return 0;
}
