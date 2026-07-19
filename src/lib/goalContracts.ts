/**
 * Canonical Goals / Family Fund contracts (pure, no Firestore)
 * ------------------------------------------------------------
 * Single source of truth for goal types, contribution ownership maths, matching
 * policy, idempotency key/hash helpers, and legacy-doc normalisation.
 *
 * This module is intentionally free of any Firestore / React imports so it can be
 * unit-tested in isolation (Phase 0) and reused by the trusted transaction APIs
 * (Phase 1), Firestore rules tests, and the UI.
 *
 * Money is always integer minor units (pence). No floats anywhere.
 *
 * Ownership source of truth: the goal-specific immutable `contributions` ledger
 * (see design 2.2 / 7). `netChild` is computed from that ledger, never from
 * `wallet_transactions`.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type GoalKind = 'family' | 'child';

/**
 * Goal status state machine (design 3.9, correction 8):
 *   active | reached | completed_purchased | completed_returned | cancelled
 * A withdrawal that drops the balance below target may transition
 * `reached` back to `active`.
 */
export type GoalStatus =
  | 'active'
  | 'reached'
  | 'completed_purchased'
  | 'completed_returned'
  | 'cancelled';

export type MatchingMode = 'none' | 'auto' | 'manual';

export interface MatchingPolicy {
  mode: MatchingMode;
  perX: number; // pence a child must contribute to earn a match
  matchY: number; // pence the parent adds per perX
  capPence?: number; // optional per-contribution cap
}

/**
 * Parent contribution at goal creation (design 2.2 / 5.2). External money only —
 * it is NEVER debited from a parent wallet. The authoritative product spec
 * (5.2) models the parent seed as a single external `amountPence`; the UI
 * exposes it as a MUTUALLY EXCLUSIVE choice between a fixed GBP amount and a
 * percentage of the target. The two modes are never combined: a parent picks
 * exactly one mode (or none). This is enforced both in the UI (mode selector)
 * and here (validation rejects any attempt to supply both simultaneously).
 */
export type ParentContributionMode = 'none' | 'fixed' | 'percent';

export interface ParentContributionInput {
  /** Which mode the parent chose. Drives mutual exclusivity. */
  mode?: ParentContributionMode;
  /** Fixed external amount in pence (only valid when mode === 'fixed'). */
  fixedPence?: number;
  /** Percentage of the goal target 0-100 (only valid when mode === 'percent'). */
  percent?: number;
}

/**
 * Upper bound for a parent contribution percentage. A parent may seed at most
 * 100% of the target via the percentage mode.
 */
export const MAX_PARENT_CONTRIBUTION_PERCENT = 100;

/**
 * Validate a parent contribution input.
 *
 * UX contract (mutually exclusive GBP OR percent):
 *  - `mode` selects exactly one of `fixed` | `percent` | `none`.
 *  - Supplying BOTH `fixedPence` and `percent` (regardless of mode) is rejected.
 *  - blank / zero / undefined / mode 'none' means NO parent contribution (0).
 *
 * Hardening (reject before any Firestore write):
 *  - NaN, Infinity, -Infinity, or any non-finite value is rejected.
 *  - fractional pence (non-integer pence) is rejected.
 *  - negative values are rejected.
 *  - fixed amount must satisfy 0 <= fixed <= target.
 *  - percentage must satisfy 0 <= percent <= 100.
 *  - the calculated contribution must not exceed the target.
 *
 * Returns the resolved total contribution in pence (always an integer).
 * Throws on any invalid value.
 */
export function validateParentContribution(
  input: ParentContributionInput | undefined,
  targetAmountPence: number,
): number {
  if (!input || input.mode === 'none' || (input.fixedPence == null && input.percent == null)) {
    return 0;
  }

  const hasFixed = input.fixedPence != null;
  const hasPercent = input.percent != null;

  // Mutual exclusivity: never both at once.
  if (hasFixed && hasPercent) {
    throw new Error('Parent contribution must be either a fixed amount OR a percentage, not both');
  }

  // Reject non-finite / malformed values up front.
  const raw = hasFixed ? input.fixedPence! : input.percent!;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Number.isNaN(raw)) {
    throw new Error('Parent contribution must be a finite number');
  }

  if (hasFixed) {
    const fixed = input.fixedPence!;
    if (!Number.isInteger(fixed)) {
      throw new Error('Parent contribution amount must be a whole number of pence');
    }
    if (fixed < 0) throw new Error('Parent contribution amount cannot be negative');
    if (fixed > targetAmountPence) {
      throw new Error('Parent contribution amount cannot exceed the goal target');
    }
    if (fixed === 0) return 0;
    return fixed;
  }

  // percent mode
  const percent = input.percent!;
  if (!Number.isFinite(percent) || Number.isNaN(percent)) {
    throw new Error('Parent contribution percentage must be a finite number');
  }
  if (percent < 0) throw new Error('Parent contribution percentage cannot be negative');
  if (percent > MAX_PARENT_CONTRIBUTION_PERCENT) {
    throw new Error(`Parent contribution percentage cannot exceed ${MAX_PARENT_CONTRIBUTION_PERCENT}%`);
  }
  if (percent === 0) return 0;
  const percentPence = Math.round((percent / 100) * targetAmountPence);
  if (percentPence > targetAmountPence) {
    throw new Error('Parent contribution percentage cannot exceed the goal target');
  }
  return percentPence;
}

/**
 * Contribution ledger entry types (design 2.2, correction 4). These are the
 * only recognised kinds; the UI breakdown and `netChild` derive from them.
 */
export type ContributionType =
  | 'child_contribution' // child wallet -> goal (owned by child)
  | 'parent_contribution' // external parent money (not owned by any child)
  | 'auto_match' // automatic match leg (parent-owned, not withdrawable)
  | 'manual_match' // approved manual-match proposal leg (parent-owned)
  | 'child_withdrawal' // child withdrawal approved -> back to child wallet
  | 'completion_refund' // per-child refund on Return Funds to Wallets
  | 'external_closure'; // non-wallet closure of parent/match portions

export type ContributionOwnerType = 'child' | 'parent';

export interface ContributionLeg {
  contribId?: string;
  goalId?: string;
  type: ContributionType;
  ownerType: ContributionOwnerType;
  ownerId: string;
  amountPence: number; // positive for in, negative for out
  matchPence?: number;
  matchContribId?: string;
  sourceContributionId?: string;
  proposedMatchAmountPence?: number;
  sourceRequestId?: string;
  walletTxId?: string;
  status?: 'pending' | 'applied' | 'rejected' | 'reversed';
  createdBy?: string;
  createdByName?: string;
  createdAt?: unknown;
  effectSnapshot?: Record<string, unknown>;
}

export interface GoalRequest {
  requestType: 'contribution' | 'withdrawal';
  goalId: string;
  childId: string;
  amountPence: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: unknown;
  rejectionReason?: string;
  contribId?: string;
  walletTxId?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: unknown;
  dedupeKey?: string;
}

export interface GoalLedgerEntry {
  entryId?: string;
  goalId?: string;
  type: ContributionType;
  amountPence: number;
  ownerId?: string;
  createdAt?: unknown;
  note?: string;
}

/**
 * Explicit manual-match approval request (design 2.7, correction 6). The
 * `sourceContributionId` and `proposedMatchAmountPence` are immutable once
 * created; only `status` and reviewer fields change.
 */
export interface MatchProposal {
  proposalId?: string;
  goalId: string;
  sourceContributionId: string; // immutable
  proposedMatchAmountPence: number; // immutable
  status: 'proposed' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: unknown;
  createdAt?: unknown;
}

export interface Goal {
  goalId?: string;
  title: string;
  kind: GoalKind;
  childId?: string;
  targetAmountPence: number;
  currentAmountPence: number;
  currency: string;
  status: GoalStatus;
  matching?: MatchingPolicy;
  createdBy?: string;
  createdByName?: string;
  createdAt?: unknown;
  completedAt?: unknown;
  completedBy?: string;
  completedMode?: 'purchased' | 'returned' | 'cancelled';
  version: number;
}

// ---------------------------------------------------------------------------
// Contribution ownership maths (design 7)
// ---------------------------------------------------------------------------

/**
 * Remaining net child-owned contribution still in the goal and available to
 * withdraw/return. Computed from the goal-specific `contributions` ledger only.
 *
 * netChild = sum child_contribution (owner) - sum child_withdrawal (owner)
 *            - sum completion_refund (owner)
 *
 * Parent and match contributions (parent_contribution, auto_match, manual_match)
 * and external_closure entries are excluded.
 */
export function computeNetChild(contributions: ContributionLeg[], childId: string): number {
  let net = 0;
  for (const c of contributions) {
    if (c.ownerId !== childId) continue;
    if (c.status && c.status !== 'applied') continue;
    switch (c.type) {
      case 'child_contribution':
        net += c.amountPence; // positive in
        break;
      case 'child_withdrawal':
      case 'completion_refund':
        net += c.amountPence; // negative out
        break;
      default:
        // parent_contribution, auto_match, manual_match, external_closure:
        // never owned by a child -> ignored.
        break;
    }
  }
  return net;
}

// ---------------------------------------------------------------------------
// Matching maths (design 6)
// ---------------------------------------------------------------------------

/**
 * Integer match amount for a child contribution under the policy.
 *   matchPence = min( floor(childAmount / perX) * matchY, capPence ?? infinity )
 * `mode:'none'` and `mode:'manual'` return 0 here (manual is applied explicitly
 * via a proposal, never auto-computed at contribution time).
 */
export function computeMatchPence(childAmount: number, policy: MatchingPolicy): number {
  if (policy.mode !== 'auto') return 0;
  if (childAmount <= 0 || policy.perX <= 0) return 0;
  const pairs = Math.floor(childAmount / policy.perX);
  const raw = pairs * policy.matchY;
  if (policy.capPence != null && raw > policy.capPence) return policy.capPence;
  return raw;
}

// ---------------------------------------------------------------------------
// Legacy doc normalisation (design 13)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw goal document (legacy `savings_goals` or v1) into the canonical
 * `Goal` shape. Tolerates legacy major-unit fields `targetAmount` /
 * `currentAmount` by converting to pence. Never deletes old fields from the
 * source; returns a new object.
 */
export function normalizeGoalDoc(doc: Record<string, unknown>): Goal {
  const legacyTarget = typeof doc.targetAmount === 'number' ? doc.targetAmount : 0;
  const legacyCurrent = typeof doc.currentAmount === 'number' ? doc.currentAmount : 0;

  const targetAmountPence =
    typeof doc.targetAmountPence === 'number'
      ? (doc.targetAmountPence as number)
      : Math.round(legacyTarget * 100);

  const currentAmountPence =
    typeof doc.currentAmountPence === 'number'
      ? (doc.currentAmountPence as number)
      : Math.round(legacyCurrent * 100);

  const childId = typeof doc.childId === 'string' ? (doc.childId as string) : undefined;

  const status = (typeof doc.status === 'string' ? doc.status : 'active') as GoalStatus;

  return {
    goalId: typeof doc.goalId === 'string' ? (doc.goalId as string) : undefined,
    title: typeof doc.title === 'string' ? (doc.title as string) : '',
    kind: (typeof doc.kind === 'string' ? doc.kind : childId ? 'child' : 'family') as GoalKind,
    childId,
    targetAmountPence,
    currentAmountPence,
    currency: typeof doc.currency === 'string' ? (doc.currency as string) : 'GBP',
    status,
    matching: (doc.matching as MatchingPolicy | undefined) ?? { mode: 'none', perX: 0, matchY: 0 },
    createdBy: typeof doc.createdBy === 'string' ? (doc.createdBy as string) : undefined,
    createdByName: typeof doc.createdByName === 'string' ? (doc.createdByName as string) : undefined,
    createdAt: doc.createdAt,
    completedAt: doc.completedAt,
    completedBy: typeof doc.completedBy === 'string' ? (doc.completedBy as string) : undefined,
    completedMode: doc.completedMode as 'purchased' | 'returned' | 'cancelled' | undefined,
    version: typeof doc.version === 'number' ? (doc.version as number) : 1,
  };
}

// ---------------------------------------------------------------------------
// Idempotency (design 14, correction 7)
// ---------------------------------------------------------------------------

/**
 * Stable hash of a normalised request payload. Used by the atomic idempotency
 * operation document so a reused key with a *different* requestHash is rejected.
 * Implemented with a simple, deterministic string hash (FNV-1a style) so it is
 * stable across runs and platforms without external deps.
 */
export function requestHashOf(request: unknown): string {
  const json = JSON.stringify(sortDeep(request));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range
    h = Math.imul(h, 0x01000193);
  }
  // unsigned hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Deterministic idempotency key for a goal contribution. */
export function goalContributionKey(goalId: string, clientReqId: string): string {
  return `goalContribution:${goalId}:${clientReqId}`;
}

/** Deterministic idempotency key for a goal withdrawal request/approval. */
export function goalWithdrawalKey(goalId: string, clientReqId: string): string {
  return `goalWithdrawal:${goalId}:${clientReqId}`;
}

/** Deterministic idempotency key for a manual-match proposal approval. */
export function goalMatchKey(proposalId: string, clientReqId: string): string {
  return `goalMatch:${proposalId}:${clientReqId}`;
}
