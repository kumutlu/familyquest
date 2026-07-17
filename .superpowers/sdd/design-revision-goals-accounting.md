# Design Revision: Goals, Accounting Guarantees, Manual-Match Approval, Idempotency & Contribution UI

> **SUPERSEDED.** This revision note contained several points that conflict with
> the confirmed product rules. It has been **withdrawn** in favour of the
> corrected authoritative documents:
> - [`docs/superpowers/specs/2026-07-17-family-fund-goals-design.md`](docs/superpowers/specs/2026-07-17-family-fund-goals-design.md)
> - [`docs/superpowers/plans/2026-07-17-family-fund-goals-implementation.md`](docs/superpowers/plans/2026-07-17-family-fund-goals-implementation.md)
>
> The following positions in this note are **rescinded** and must not be
> implemented:
> - §2 `claimGoal()` returning the full `currentAmount` to one wallet (correction 1).
> - §2 replacing "Mark as purchased" / "Return funds to wallets" with a generic
>   `claimGoal()` action (correction 2).
> - §5.2 deleting existing Firestore validators (`isValidDepositCredit`, etc.)
>   (correction 5).
> - The `processing` idempotency state in §4 (correction 7).
>
> The authoritative design now uses goal statuses `active | reached |
> completed_purchased | completed_returned | cancelled`, an explicit manual-match
> `match_proposals` approval request, an atomic idempotency operation document, a
> goal-specific immutable `contributions` ledger, and preserves all existing
> Firestore financial validators and auth/push behaviour.
>
> Status: **WITHDRAWN — DO NOT IMPLEMENT.** No code has been changed.

---

## 0. Context & Current State

The current system has:

- **Savings goals** stored in `families/{familyId}/savings_goals` with fields
  `childId, title, targetAmount, currentAmount, createdAt`
  ([`src/lib/api.ts:1138`](src/lib/api.ts:1138)). There is **no status enum** and
  **no dedicated UI** — only the data layer and store subscription exist.
- **Accounting guarantees** enforced inside Firestore security rules
  (`firestore.rules`, 1373 lines) via validators such as
  `isValidDepositCredit`, `isValidWithdrawalDeduction`,
  `isValidParentTransferDeduction` ([`firestore.rules:143`](firestore.rules:143)).
  These rules re-derive ledger math that the client transaction already
  computed, duplicating logic and making the rules brittle.
- **Manual matching** handled by `legacyPetboxMatcher`
  ([`src/lib/legacyPetboxMatcher.ts`](src/lib/legacyPetboxMatcher.ts)) which
  auto-matches a `fund_transaction` to an approved `petbox_request` with **no
  explicit human approval step**. Ambiguous matches ("Multiple matches") are
  flagged for "manual intervention" but there is no workflow to resolve them.
- **Idempotency** is ad-hoc: only notifications use a deterministic `dedupeKey`
  written as the document id ([`src/lib/notifications.ts:229`](src/lib/notifications.ts:229)).
  Wallet/fund/transfer mutations rely on Firestore transaction retries with no
  explicit idempotency token, so a retried client call can double-apply if the
  first attempt committed but the client never saw the result.

The six revisions below address these gaps.

---

## 1. Add `GoalStatus.reached`

### 1.1 New status enum

Introduce a canonical savings-goal status type (mirroring the money-request
pattern in [`src/lib/moneyRequestContracts.ts:30`](src/lib/moneyRequestContracts.ts:30)):

```ts
// src/lib/goalContracts.ts (new)
export type GoalStatus =
  | 'active'        // child is contributing, currentAmount < targetAmount
  | 'reached'       // currentAmount >= targetAmount; awaiting parent claim
  | 'completed'     // parent claimed; funds swept, balance = 0 (see §2)
  | 'cancelled';    // parent/owner abandoned the goal
```

### 1.2 Transition rules

| From → To | Actor | Trigger |
|-----------|-------|---------|
| `active` → `reached` | system (transaction) | `currentAmount >= targetAmount` detected inside the contribution transaction |
| `reached` → `completed` | parent/owner | explicit `claimGoal()` call (§2) |
| `active`/`reached` → `cancelled` | parent/owner | explicit cancel; any held/allocated funds returned to wallet |
| `reached` → `active` | system (transaction) | a reversal reduces `currentAmount` below `targetAmount` |

### 1.3 Storage

`savings_goals` documents gain a `status: GoalStatus` field (default `'active'`
on create). The `currentAmount` field is retained and remains the source of
truth for progress; `status` is a derived-but-persisted state machine field
updated atomically within the same transaction that mutates `currentAmount`.

### 1.4 UI signal (existing hook)

The existing "Goal reached! Waiting for parent to claim." banner in
[`src/pages/Family.tsx:137`](src/pages/Family.tsx:137) is generalized to read
`goal.status === 'reached'` rather than a computed `challengeProgress >= 100`.

---

## 2. Completed returned goals finish with `balance = 0`

### 2.1 Problem

Today a savings goal has no notion of "returned to wallet." When a goal is
completed or cancelled, the money that was allocated to it must be explicitly
returned to the child's wallet, and the goal's tracked balance must be zeroed so
it cannot be double-counted or re-claimed.

### 2.2 Behaviour

- `claimGoal(familyId, goalId)` (parent/owner only):
  1. Reads the goal; requires `status === 'reached'`.
  2. Transfers `currentAmount` pence back into the child's wallet balance
     (a `goal_payout` wallet transaction, `walletDeltaPence = +currentAmount`).
  3. Sets `goal.currentAmount = 0` and `goal.status = 'completed'`.
  4. Records an `effectSnapshot` on the goal payout so it is reversible
     (see [`src/lib/reversalContracts.ts`](src/lib/reversalContracts.ts)).
- `cancelGoal(familyId, goalId)` (parent/owner only):
  1. If `currentAmount > 0`, returns it to the wallet (same payout mechanism).
  2. Sets `currentAmount = 0`, `status = 'cancelled'`.

In **both** terminal states the goal's `currentAmount` (its "balance") is `0`.
The invariant is enforced by the trusted transaction API (§5), not by client
writes.

### 2.3 Invariant

> A `savings_goals` document with `status` in `{'completed','cancelled'}` MUST
> have `currentAmount === 0`. The transaction API asserts this before commit and
> the Firestore rule (§5) rejects any direct client write that violates it.

---

## 3. Explicit manual-match approval workflow

### 3.1 Problem

`legacyPetboxMatcher` auto-links a `fund_transaction` to an approved
`petbox_request` and, on ambiguity, asks for "manual intervention" with no
concrete resolution path. There is no record that a human reviewed and approved
the match.

### 3.2 New `match_proposals` collection

```
families/{familyId}/match_proposals/{proposalId}
{
  familyId: string
  fundTransactionId: string
  candidateRequestIds: string[]   // 0 = unmatched, 1 = auto, >1 = ambiguous
  selectedRequestId: string | null
  status: 'proposed' | 'approved' | 'rejected' | 'auto_applied'
  proposedBy: string              // uid (system or user)
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: timestamp
  createdAt: timestamp
}
```

### 3.3 Workflow

1. **Propose.** When a `fund_transaction` (petbox contribution/expense) is
   created, the trusted transaction API runs the matcher
   ([`src/lib/legacyPetboxMatcher.ts`](src/lib/legacyPetboxMatcher.ts)):
   - Exactly one candidate → create proposal with `status: 'auto_applied'`,
     `selectedRequestId` set, and immediately apply the ledger linkage.
   - Zero or multiple candidates → create proposal with `status: 'proposed'`,
     `candidateRequestIds` listed, `selectedRequestId: null`. **No money is
     moved or linked yet.**
2. **Approve (parent/owner).** `approveMatch(proposalId, selectedRequestId)`:
   - Validates `selectedRequestId ∈ candidateRequestIds`.
   - Applies the ledger linkage (refund/expense against the chosen request) in a
     transaction, sets `status: 'approved'`, records reviewer fields (mirroring
     [`src/lib/approvalContracts.ts:5`](src/lib/approvalContracts.ts:5)).
3. **Reject (parent/owner).** `rejectMatch(proposalId)`: sets `status:
   'rejected'`, leaves the `fund_transaction` unlinked (it remains a manual
   adjustment).

### 3.4 Authorization contract

Add to a new `matchContracts.ts` (parallel to
[`src/lib/moneyRequestContracts.ts`](src/lib/moneyRequestContracts.ts)):

```ts
export function canReviewMatch(proposal, currentUser): boolean {
  return isParentRole(currentUser.role)
    && currentUser.familyId === proposal.familyId
    && proposal.status === 'proposed';
}
```

The UI (`ApprovalCenter`) surfaces `proposed` matches alongside money requests
and transfer requests.

---

## 4. Concrete idempotency storage mechanism

### 4.1 Problem

Firestore `runTransaction` retries the callback on contention, but a *client*
retry (network drop after commit) can re-invoke the whole mutation. Today only
notifications are idempotent ([`src/lib/notifications.ts:229`](src/lib/notifications.ts:229)).
Wallet deposits/withdrawals/transfers have no idempotency token, so a retried
call could create a second transaction document and double-apply the balance
delta.

### 4.2 Idempotency key collection

```
families/{familyId}/idempotency/{key}
{
  key: string                 // client-supplied deterministic idempotency key
  status: 'processing' | 'completed'
  resultRef: string | null    // path to the primary created document (e.g. wallet_transactions/{id})
  createdAt: timestamp
  expiresAt: timestamp        // TTL, e.g. +24h
}
```

### 4.3 Protocol (inside every trusted mutation, §5)

1. Caller generates a deterministic `idempotencyKey`
   (e.g. `deposit:{familyId}:{childId}:{clientReqId}` where `clientReqId` is a
   UUID the client creates once per user action).
2. The transaction **first** does `transaction.get(idempotencyRef)`:
   - If `status === 'completed'` → return `resultRef` without re-applying
     (idempotent success).
   - If `status === 'processing'` → treat as in-flight; return the same
     `resultRef` if present, else fail fast to avoid double-apply.
   - If absent → `transaction.set(idempotencyRef, { status: 'processing', ... })`.
3. Apply the ledger writes.
4. Before commit, `transaction.set(idempotencyRef, { status: 'completed',
   resultRef })`.

Because the idempotency read and the ledger writes share one transaction, the
"completed" state is atomic with the mutation. A client retry with the same key
sees `completed` and returns the original `resultRef`.

### 4.4 Key generation helper

```ts
// src/lib/idempotency.ts (new)
export const idempotencyKey = (op: string, familyId: string, scope: string, clientReqId: string) =>
  `${op}:${familyId}:${scope}:${clientReqId}`;
```

The client generates `clientReqId` per user gesture (e.g. button press) and
threads it through `depositToWallet`, `withdrawFromWallet`, `claimGoal`,
`approveMatch`, etc.

### 4.5 TTL cleanup

A Firestore TTL policy on `idempotency/{key}.expiresAt` auto-deletes old keys.
This is the *only* new index/rule requirement for idempotency.

---

## 5. Simplify Firestore rules; move accounting guarantees into trusted transaction APIs

### 5.1 Principle

Firestore rules become a **coarse authorization + shape gate**. All
**arithmetic/ledger invariants** (balance non-negativity where required, delta
consistency, effect-snapshot presence) move into the trusted transaction APIs
that already run in `runTransaction` ([`src/lib/api.ts:1012`](src/lib/api.ts:1012)).

### 5.2 Rules to DELETE

Remove the brittle per-operation validators that re-derive ledger math:
- `isValidDepositCredit` ([`firestore.rules:143`](firestore.rules:143))
- `isValidWithdrawalDeduction` ([`firestore.rules:162`](firestore.rules:162))
- `isValidParentTransferDeduction` ([`firestore.rules:181`](firestore.rules:181))
- `isValidParentTransferCredit` and any sibling `isValid*Deduction/Credit`
  helpers that compare `tx.data.amount == (data.balance - oldData.balance)`.

Replace the wallet/fund write rules with a single guard:

```
function isTrustedWrite(data) {
  return isParent(familyId)
    && data.keys().hasOnly([...allowed fields...])
    && data.effectSnapshot is map
    && data.effectSnapshot.schemaVersion == 1;
}
```

### 5.3 Rules to KEEP (coarse)

- Authentication / role helpers (`isAuthenticated`, `isOwner`, `isParent`,
  `isFamilyMember`) — unchanged.
- Collection-level create/read rules: only parents/owners may create
  `wallet_transactions`, `fund_transactions`, `savings_goals` writes; family
  members may read.
- **Post-condition assertions only** (cheap, no cross-document math):
  - `savings_goals`: reject any write where `status in ['completed','cancelled']`
    and `currentAmount != 0` (the §2 invariant).
  - `idempotency`: allow create/update only by the family; enforce `expiresAt`
    is a future timestamp.
  - `match_proposals`: only parents/owners may transition `proposed →
    approved|rejected`; `proposed` rows are system-created.

### 5.4 Trusted transaction API responsibilities (the new source of truth)

Each mutation in [`src/lib/api.ts`](src/lib/api.ts) becomes responsible for:
1. Reading current balances inside `runTransaction`.
2. Computing and asserting all deltas (e.g. `currentBalance >= amount` for
   withdrawals, `currentAmount >= targetAmount` for `reached`).
3. Writing the `effectSnapshot` ([`src/lib/reversalContracts.ts:1`](src/lib/reversalContracts.ts:1))
   so every money movement is reversible.
4. Acquiring the idempotency lock (§4) before applying writes.
5. Setting derived status fields (`goal.status`, `match_proposal.status`)
   atomically.

This removes ~200+ lines of duplicated arithmetic from `firestore.rules` and
centralizes correctness in one tested layer (the existing
`api.*.test.ts` suite already exercises these transactions).

---

## 6. Contribution breakdown UI requirements

### 6.1 Goal

When viewing a savings goal (especially one `reached`/`completed`), the child and
parent must see **where the money came from**, not just a single
`currentAmount`. Contributions arrive from multiple sources today: behaviour
rewards, wallet deposits, petbox contributions, transfers. The UI must break
these down.

### 6.2 Data requirements

- Each `wallet_transactions` / `fund_transactions` entry that credits a goal
  carries a `goalId` and a `contributionSource` enum:
  `'behaviour' | 'deposit' | 'petbox' | 'transfer' | 'adjustment' | 'payout'`.
- A derived `goalContributions` view (computed client-side from the
  `wallet_transactions` subscription already in
  [`src/store/useStore.ts:584`](src/store/useStore.ts:584)) groups by
  `goalId` + `contributionSource` and sums `amount`.

### 6.3 UI components

1. **Goal progress card** (new `src/components/goals/GoalCard.tsx`):
   - Title, `targetAmount`, `currentAmount`, percentage.
   - Status pill: `active` / `reached` / `completed` / `cancelled`
     (driven by §1 enum, not computed progress).
   - "Claim" button visible to parents/owners **only** when `status ===
     'reached'` (triggers §2 `claimGoal`).
2. **Contribution breakdown panel** (new `src/components/goals/ContributionBreakdown.tsx`):
   - Stacked bar or list showing each `contributionSource` share of
     `currentAmount` (or of the original `targetAmount` for completed goals).
   - Per-source subtotal and percentage.
   - For `completed` goals, a distinct "Returned to wallet" row showing the
     `payout` of the full `currentAmount` (ties to §2 `balance = 0`).
3. **Match proposals queue** (extends `ApprovalCenter`): lists `proposed`
   `match_proposals` with candidate requests and Approve/Reject controls (§3).
4. **Accessibility & copy requirements:**
   - All amounts rendered via the existing `currencySymbol` formatter
     ([`src/components/funds/FundCard.tsx:144`](src/components/funds/FundCard.tsx:144)).
   - Breakdown must be readable without color alone (labels + values).
   - Empty state when a goal has zero contributions.

### 6.4 State wiring

- `useStore` gains a `goalContributions` selector (memoized grouping).
- `bootstrapQueries` ([`src/lib/bootstrapQueries.ts:182`](src/lib/bootstrapQueries.ts:182))
  already subscribes `savingsGoals` and `walletTransactions`; no new subscription
  needed, only the grouping selector.

---

## 7. Implementation order (for later, not now)

1. `goalContracts.ts` + `GoalStatus` enum + `savings_goals.status` migration.
2. Trusted transaction APIs: `claimGoal`, `cancelGoal`, contribution-source
   tagging (§2, §6.2).
3. `idempotency.ts` + wire into all money mutations (§4).
4. `matchContracts.ts` + `match_proposals` + `approveMatch`/`rejectMatch` (§3).
5. Firestore rules simplification + TTL policy (§5).
6. UI: `GoalCard`, `ContributionBreakdown`, `ApprovalCenter` match queue (§6).
7. Tests: extend `api.*.test.ts`, add `goalContracts.test.ts`,
   `idempotency.test.ts`, `matchContracts.test.ts`.

---

## 8. Open questions / risks

- **Legacy goals:** existing `savings_goals` docs lack `status`. Migration
  defaults them to `'active'`; a backfill sets `reached` where
  `currentAmount >= targetAmount`.
- **Reversing a completed goal payout:** the `goal_payout` wallet transaction
  carries an `effectSnapshot` so reversal returns money to the goal; the
  transaction API must restore `currentAmount` and set `status` back to
  `reached` (not `active`) to preserve history.
- **Idempotency key collision:** clients must generate a unique `clientReqId`
  per gesture; reusing a key intentionally is the *mechanism* for safe retries,
  so the key must never be reused for a *different* logical action.
