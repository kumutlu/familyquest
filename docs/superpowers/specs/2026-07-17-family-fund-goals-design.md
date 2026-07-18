# Family Fund & Goals — Design Specification

**Date:** 2026-07-17
**Status:** Design (no implementation)
**Scope:** Production-quality "Goals / Family Fund" feature for FamilyQuest.

This document specifies product behaviour, data model, financial invariants,
permissions, transaction flows, matching logic, contribution ownership, approval
flows, notification flows, UI structure, Firestore rules, error handling,
concurrency, testing, v1 exclusions, and migration/backward compatibility.

It is the authoritative design. The companion implementation plan lives at
[`../plans/2026-07-17-family-fund-goals-implementation.md`](../plans/2026-07-17-family-fund-goals-implementation.md).

---

## 1. Product Behaviour

A **Goal** is a named savings target owned by a family. Two kinds exist:

- **Family goal** — created by a parent/owner, visible to the whole family, may
  receive contributions from multiple children and from parents (external money).
- **Child-specific goal** — created by a parent/owner *for* a specific child, or
  created by a child for themselves (subject to the existing `savings_goals`
  rules), and scoped to that child's contributions plus optional parent support.

Money in a goal is **locked**. It cannot be spent or moved except through the
two parent-only completion paths:

1. **Mark as purchased** — the goal is closed as fulfilled; funds remain in the
   goal (consumed). No wallet movement.
2. **Return funds to wallets** — every child's remaining *owned* net contribution
   is refunded to that child's own wallet, separately and atomically. Parent and
   match contributions are **not** returned to any child wallet.

Children may:

- Contribute from their own wallet (real wallet→goal transfer, atomic).
- Request a withdrawal of *only their own remaining net contribution*; this
  requires parent approval and never moves money until approved.
- View goal progress, their own contribution, and the goal ledger.

Parents/owners may:

- Create family and child-specific goals, set targets, currency, and matching
  policy.
- Make external contributions (no parent wallet exists).
- Configure matching as **automatic** or **manual**.
- Approve/reject child contributions (if gated) and child withdrawal requests.
- Complete or cancel a goal (parent-only).
- Mark a goal as purchased or return funds to wallets.

### Confirmed rules (non-negotiable)

- Parents do **not** have wallet balances.
- Parent contributions are **external money** (not from any wallet).
- Children contribute only from their own wallet.
- Child wallet and goal balances update **atomically** in one `runTransaction`.
- Children cannot directly withdraw goal money; withdrawal requires parent approval.
- A child may withdraw only their own remaining **net** contributions.
- Parent and match contributions cannot be withdrawn into a child wallet.
- Family goals may contain contributions from multiple children.
- Returning funds refunds each child's remaining owned contribution **separately**.
- Matching supports **automatic** and **manual** modes.
- Matching uses **integer amount pairs** (e.g. match 50p per £1 → `{perX: 100, matchY: 50}`),
  never floating-point ratios.
- Goal funds are **locked**.
- Only parents may complete or cancel a goal.
- Completion options: **Mark as purchased** or **Return funds to wallets** (two
  distinct actions; never merged into a single generic claim).
- Goal statuses are exactly `active`, `reached`, `completed_purchased`,
  `completed_returned`, `cancelled`. A withdrawal that drops the balance below
  target may transition `reached` back to `active`.
- Manual matching requires an explicit approval request: a child contribution
  creates a `match_proposals` entry with immutable `sourceContributionId` and
  `proposedMatchAmountPence`; a selected parent approves (crediting the match
  exactly once) or rejects (leaving the child contribution unchanged).
- Contribution ownership is derived from a goal-specific immutable `contributions`
  ledger, **not** from `wallet_transactions`.
- Financial ledger entries are immutable; corrections use new compensating
  entries, never mutation or reversal of the original record.
- Idempotency is atomic: the idempotency record and all related financial writes
  share one `runTransaction`; a reused key with a different `requestHash` is
  rejected; no `processing` state lingers after a failed transaction.
- No full i18n in v1 (reuse existing `formatMoney`/`CurrencyDisplay` with family currency).
- No deployment; do not change the working auth bootstrap or push behaviour.

---

## 2. Data Model

All monetary values are stored as **integer minor units** (pence for GBP,
`amountPence: int`). The family currency defaults to `GBP` and is read from
`familyData.currency` (existing field; default symbol `'£'`).

### 2.1 `families/{familyId}/goals/{goalId}`

Superset of the existing `savings_goals` document so the collection is reused
(see §13). New fields are additive; old fields remain valid.

| Field | Type | Notes |
|---|---|---|
| `goalId` | string | doc id (mirror) |
| `title` | string | required |
| `kind` | `'family' \| 'child'` | new; default `'child'` for legacy docs |
| `childId` | string? | set when `kind == 'child'`; legacy docs already have it |
| `targetAmountPence` | int | new canonical; legacy `targetAmount` (major units) migrated to this |
| `currentAmountPence` | int | **derived/locked** sum of all contribution legs' net effect; maintained by transactions |
| `currency` | string | e.g. `'GBP'`; default `'GBP'` |
| `status` | `'active' \| 'reached' \| 'completed_purchased' \| 'completed_returned' \| 'cancelled'` | new; legacy docs default `'active'` |
| `matching` | map? | `{ mode: 'none'\|'auto'\|'manual', perX: int, matchY: int, capPence: int? }` |
| `createdBy` | string | uid |
| `createdByName` | string | |
| `createdAt` | timestamp | |
| `completedAt` | timestamp? | |
| `completedBy` | string? | |
| `completedMode` | `'purchased' \| 'returned' \| 'cancelled'`? | |
| `version` | int | schema version, starts at `1` |

> The existing `savings_goals` doc shape (`childId`, `title`, `targetAmount`,
> `currentAmount`, `createdAt`) is preserved. `targetAmount`/`currentAmount` are
> treated as **major-unit legacy** and a one-time migration writes the
> `*Pence` equivalents. Reads must tolerate either shape (see §13).

### 2.2 `families/{familyId}/goals/{goalId}/contributions/{contribId}`

Immutable, goal-specific contribution ledger of every money movement into or out
of a goal. Append-only. **This ledger — not `wallet_transactions` — is the
authoritative source of contribution ownership and the UI contribution breakdown
(§7, §10).** `wallet_transactions` remains the general wallet movement record but
must never be used to derive goal contribution ownership.

| Field | Type | Notes |
|---|---|---|
| `contribId` | string | doc id |
| `goalId` | string | |
| `type` | `'child_contribution' \| 'parent_contribution' \| 'auto_match' \| 'manual_match' \| 'child_withdrawal' \| 'completion_refund' \| 'external_closure'` | |
| `ownerType` | `'child' \| 'parent'` | who supplied the principal |
| `ownerId` | string | child uid, or parent uid for external |
| `amountPence` | int | positive for in, negative for out |
| `matchPence` | int | match amount generated by this contribution (0 unless matched) |
| `matchContribId` | string? | link to the generated match contribution |
| `sourceContributionId` | string? | for `auto_match`/`manual_match`: immutable link to the child contribution that triggered the match |
| `proposedMatchAmountPence` | int? | for `manual_match`: the approved proposed amount (immutable once approved) |
| `sourceRequestId` | string? | links to `goal_requests` when approval-gated |
| `walletTxId` | string? | links to `wallet_transactions` when a wallet moved |
| `status` | `'pending' \| 'applied' \| 'rejected' \| 'reversed'` | |
| `createdBy` | string | |
| `createdByName` | string | |
| `createdAt` | timestamp | |
| `effectSnapshot` | map | canonical effect snapshot (mirrors existing pattern) |

**Contribution ownership:** each `child_contribution` records `ownerId` and its
`amountPence`. The child's *remaining net contribution* for withdrawal/return is
computed as:

```
netChild(ownerId) = Σ amountPence of applied child_contribution where ownerId == child
                   − Σ amountPence of applied child_withdrawal where ownerId == child
                   − Σ amountPence of applied completion_refund where ownerId == child
```

Parent and match contributions (`parent_contribution`, `auto_match`,
`manual_match`) are **not** owned by any child and are excluded from `netChild`.
`external_closure` entries record the non-wallet closure of parent/match portions
and never credit a child wallet.

### 2.3 `families/{familyId}/goals/{goalId}/goal_ledger/{entryId}`

Immutable, append-only, human/audit ledger mirroring `contributions` at a coarser
grain (one entry per financial event). This satisfies the "immutable goal ledger"
requirement independently of the contribution docs. Never updated or deleted.

### 2.4 `families/{familyId}/goal_requests/{requestId}`

Approval-center requests for child-initiated, money-moving actions:

| Field | Type | Notes |
|---|---|---|
| `requestType` | `'contribution' \| 'withdrawal'` | |
| `goalId` | string | |
| `childId` | string | requester (must equal caller for contribution) |
| `amountPence` | int | for contribution: in; for withdrawal: the child's requested net |
| `status` | `'pending' \| 'approved' \| 'rejected' \| 'cancelled'` | |
| `reviewedBy` / `reviewedByName` / `reviewedAt` | | parent approval |
| `rejectionReason` | string? | |
| `contribId` | string? | set on approval (idempotency anchor) |
| `walletTxId` | string? | |
| `createdBy` / `createdByName` / `createdAt` | | |
| `dedupeKey` | string | idempotency key |

### 2.5 `families/{familyId}/wallets/{childId}` (unchanged)

`balance: int` (pence). Parents have no wallet document. Goal↔wallet transfers
update this and the goal `currentAmountPence` atomically.

### 2.6 `families/{familyId}/wallet_transactions/{txId}` (unchanged pattern)

Signed `amountPence` ledger. Goal contributions write a `type: 'goal_contribution'`
(out of wallet) and returns write `type: 'goal_return'` (into wallet).

### 2.7 `families/{familyId}/match_proposals/{proposalId}`

Explicit approval request for **manual** matching (§5.3). Created by the trusted
transaction when a `child_contribution` is applied under `matching.mode == 'manual'`.

| Field | Type | Notes |
|---|---|---|
| `proposalId` | string | doc id |
| `goalId` | string | |
| `sourceContributionId` | string | **immutable** link to the child contribution that triggered the proposal |
| `proposedMatchAmountPence` | int | **immutable** proposed match amount from policy |
| `status` | `'proposed' \| 'approved' \| 'rejected'` | |
| `reviewedBy` | string? | parent uid who approved/rejected |
| `reviewedByName` | string? | |
| `reviewedAt` | timestamp? | |
| `createdAt` | timestamp | |

The proposal is **immutable** in its `sourceContributionId` and
`proposedMatchAmountPence`; only `status` and reviewer fields change. Approval
credits the match exactly once (idempotent). Rejection leaves the child
contribution unchanged.

---

## 3. Financial Invariants

Enforced in every `runTransaction` and mirrored in Firestore rules:

1. **Atomicity:** child wallet `balance` and goal `currentAmountPence` change by
   equal and opposite integer amounts within the same transaction.
2. **No negative wallet:** a child contribution is rejected if
   `wallet.balance < amountPence`.
3. **Locked funds:** goal `currentAmountPence` only changes via the documented
   transactions; children never write it directly (rules deny).
4. **Ownership isolation:** withdrawal/return to a child wallet is bounded by that
   child's `netChild` (never includes parent/match money).
5. **Parent money is external:** parent contributions do not debit any wallet;
   they only increase goal `currentAmountPence` (and possibly a match leg).
6. **Match integrity:** match amount is `floor(childAmount / perX) * matchY`,
   capped at `capPence` when set; always integer; never exceeds contributed amount
   unless policy allows (default: match ≤ contribution).
7. **Idempotency (atomic):** every money-moving operation carries a deterministic
   idempotency operation document (§14). The operation record and **all** related
   financial writes are completed in the **same** `runTransaction`. A reused key
   with a different `requestHash` is rejected. No separate `processing` state is
   left behind after a failed transaction.
8. **Immutable ledger:** `contributions` and `goal_ledger` are append-only; status
   transitions only `pending→applied|rejected` and `applied→reversed` (reversal
   writes a new offsetting entry, never mutates the original). Completed payouts
   are **not** casually reversible: corrections use new compensating ledger
   entries, never mutation or reversal of the original transaction record.
9. **Goal status state machine:** statuses are exactly
   `active | reached | completed_purchased | completed_returned | cancelled`.
   A withdrawal that reduces `currentAmountPence` below `targetAmountPence` may
   transition `reached` back to `active`. Terminal statuses
   (`completed_purchased`, `completed_returned`, `cancelled`) permit no further
   money movement.
10. **Integer-only money:** all amounts are `int` pence; no floats anywhere.

---

## 4. Permissions

Reuse existing rule helpers: `isParent(familyId)`, `isChildInFamily(familyId, id)`,
`isFamilyMember(familyId)`, `isOwner(familyId)`.

| Action | Allowed by |
|---|---|
| Read goal / contributions / ledger | `isFamilyMember` |
| Create goal | `isParent` (family & child goals); child may create `kind:'child'` scoped to self (legacy `savings_goals` behaviour preserved) |
| Update goal metadata (title, target, matching, currency) | `isParent` |
| Delete goal (only when `active` and empty) | `isParent` |
| Child contribution (wallet→goal) | child themselves; atomic tx; may be approval-gated |
| Parent contribution (external) | `isParent` |
| Create withdrawal request | child themselves, bounded by `netChild` |
| Approve/reject contribution & withdrawal requests | `isParent` |
| Complete / cancel goal | `isParent` only |
| Return funds to wallets | `isParent` only |
| Mark as purchased | `isParent` only |

Children **cannot** directly mutate `currentAmountPence`, approve requests, or
complete/cancel goals (rules deny writes outside the allowed transaction shapes).

---

## 5. Transaction Flows

All flows run inside `runTransaction(db, ...)` with **reads-before-writes** and a
**write stage that performs zero reads** (existing convention from
[`src/lib/api.ts`](src/lib/api.ts:418)). Notification plans are resolved in the
read phase via `loadNotificationRecipientsInTransaction` and applied in the write
phase via `applyNotificationWrites` (see [`src/lib/notifications.ts`](src/lib/notifications.ts:1)).

### 5.1 Child contribution (wallet → goal)

1. Read child wallet, goal doc, (optional) existing `goal_requests` for idempotency.
2. Validate `wallet.balance >= amountPence`, goal `status in {'active','reached'}`,
   amount int > 0. (A `reached` goal may still accept contributions; see §5.4.)
3. If approval-gated: create a `goal_requests` (`pending`) and return; no balance
   change yet. Otherwise proceed to apply immediately.
4. Debit wallet `balance -= amountPence`; credit goal `currentAmountPence += amountPence`.
5. Write `wallet_transactions` (`type:'goal_contribution'`, negative),
   `contributions` (`child_contribution`, ownerId=child), and `goal_ledger` entry.
6. If `matching.mode == 'auto'`, compute match, write an `auto_match` contribution
   (with immutable `sourceContributionId`) and credit goal
   `currentAmountPence += matchPence` (parent-owned, not withdrawable).
7. If `matching.mode == 'manual'`, create a `match_proposals` approval request
   (see §5.3) carrying the immutable `sourceContributionId` and
   `proposedMatchAmountPence`; no match money is credited until a parent approves.
8. If `currentAmountPence >= targetAmountPence`, set `status = 'reached'`
   (idempotent; already `reached` is a no-op).
9. Apply notification writes (child + parent recipients).

### 5.2 Parent contribution (external)

1. Read goal; validate `status in {'active','reached'}`, amount int > 0.
2. Credit goal `currentAmountPence += amountPence` (no wallet debit).
3. Write `contributions` (`parent_contribution`, ownerType parent) + `goal_ledger`.
4. If `matching.mode == 'auto'` and policy matches on parent contributions, apply
   an `auto_match` leg (parent-owned).
5. Notify family.

### 5.3 Manual matching (explicit approval request)

Manual matching uses an **explicit approval request**, not an automatic leg:

1. When a `child_contribution` is applied and `matching.mode == 'manual'`, the
   trusted transaction creates a `match_proposals` document (see §2.7) carrying the
   immutable `sourceContributionId` (the child contribution's `contribId`) and a
   `proposedMatchAmountPence` computed from policy (`floor(childAmount/perX)*matchY`,
   capped). **No match money is credited at proposal time.**
2. The proposal surfaces in the **Approval Center** for parents/owners to review.
3. A selected parent **approves**: the trusted transaction writes a `manual_match`
   contribution (with immutable `sourceContributionId` and the approved
   `proposedMatchAmountPence`), credits goal `currentAmountPence += matchPence`
   exactly once, and sets the proposal `status='approved'`. Re-approval of the same
   proposal is idempotent (no second match).
4. A parent **rejects**: the proposal `status='rejected'`; the child contribution
   is left unchanged (no match, no wallet movement).

Manual mode gives parents full control; the match is only ever created through the
approved proposal path.

### 5.4 Child withdrawal request → parent approval → return

1. Child creates `goal_requests` (`withdrawal`, amountPence = desired net, must be
   `<= netChild(child)`).
2. Parent approves:
   - Read goal, child wallet, all contributions to compute `netChild(child)`.
   - Validate `amountPence <= netChild(child)` and goal `status in {'active','reached'}`.
   - Credit wallet `balance += amountPence`; debit goal `currentAmountPence -= amountPence`.
   - Write `wallet_transactions` (`type:'goal_return'`, positive), `contributions`
     (`child_withdrawal`, ownerId=child, negative), `goal_ledger`.
   - Mark request `approved`, set `contribId`/`walletTxId` (idempotency anchor).
   - If the debit drops `currentAmountPence < targetAmountPence` and the goal was
     `reached`, transition `status` back to `active`.
3. Rejection writes `rejected` + reason; no balance change.

### 5.5 Complete goal — Mark as purchased

Parent-only. Set `status='completed_purchased'`, `completedMode='purchased'`,
`completedAt`, `completedBy`. No wallet movement. Lock further writes (rules deny
any `currentAmountPence` change when status is terminal). Notify family
("Goal reached / purchased").

### 5.6 Complete goal — Return funds to wallets

Parent-only. For **each child** with `netChild(child) > 0`:

- Credit that child's wallet `balance += netChild(child)` (a `goal_return` wallet
  transaction).
- Debit goal `currentAmountPence -= netChild(child)`.
- Write `wallet_transactions` (`goal_return`), `contributions`
  (`completion_refund`, ownerId=child, negative), `goal_ledger`.

Parent external contributions and automatic/manual match contributions are **not**
credited to any child wallet. Instead, the parent and match portions are closed
through explicit non-wallet closure ledger entries: write `contributions`
(`external_closure`) for the remaining parent + match legs (no wallet credit), and
set `currentAmountPence = 0` atomically. Set `status='completed_returned'`,
`completedMode='returned'`. Notify each child + parents.

> **Never** return the full goal `currentAmountPence` to a single wallet. Only each
> child's remaining net child-owned contribution is refunded to that same child's
> wallet; parent and match money is closed via `external_closure` entries only.

### 5.7 Cancel goal

Parent-only, only when `status == 'active'` and `currentAmountPence == 0` (i.e.
no money locked) — or, if money is present, cancel is equivalent to "Return funds"
and must use §5.6. Set `status='cancelled'`. On cancel with money present, apply
§5.6 (per-child refund + `external_closure` + `currentAmountPence = 0`).

---

## 6. Matching Logic

- **Policy:** `matching = { mode: 'none' | 'auto' | 'manual', perX: int, matchY: int, capPence?: int }`.
- **Integer pair semantics:** for every `perX` pence a child contributes, the
  parent adds `matchY` pence. Example GBP: `perX: 100, matchY: 50` → 50p matched
  per £1. No ratios/floats.
- **Computation:** `matchPence = min( floor(childAmount / perX) * matchY, capPence ?? ∞ )`.
- **Ownership:** match legs (`auto_match`, `manual_match`) are `ownerType: 'parent'`,
  never withdrawable, never returned to a child wallet.
- **Modes:**
  - `none`: no match.
  - `auto`: match computed and applied at contribution time as an `auto_match`
    contribution (with immutable `sourceContributionId`), crediting the goal.
  - `manual`: a `match_proposals` approval request is created (§2.7, §5.3) carrying
    the immutable `sourceContributionId` and `proposedMatchAmountPence`. No match
    money is credited until a parent approves the proposal in the Approval Center;
    approval writes a `manual_match` contribution exactly once.
- **Idempotency:** a contribution is matched exactly once; the match contribution
  links back via `matchContribId` and the child contribution records `matchPence`.
  Manual approval is idempotent per proposal.

---

## 7. Contribution Ownership

- Every `child_contribution` is owned by exactly one child (`ownerId`).
- `netChild(child)` is the single source of truth for how much of a child's own
  money is still in the goal and available to withdraw/return. It is computed from
  the **goal-specific `contributions` ledger** (§2.2), never from
  `wallet_transactions`.
- Parent and match contributions (`parent_contribution`, `auto_match`,
  `manual_match`) have no child owner; they are excluded from all child
  withdrawal/return maths.
- Family goals aggregate multiple children's `netChild` values; returning funds
  iterates children and refunds each separately (§5.6).
- The UI contribution breakdown (§10) derives entirely from the `contributions`
  ledger, grouped by `type`/`ownerId`.

---

## 8. Approval Flows

Integrate with the existing **Approval Center**
([`src/components/parent/ApprovalCenter.tsx`](src/components/parent/ApprovalCenter.tsx:25))
and the normalized request model
([`src/lib/requestModel.ts`](src/lib/requestModel.ts:1)).

- Register a new `RequestCategory` adapter: `'goal'` (contribution/withdrawal).
- Add `'goal'` to `PendingApprovalKind` in [`src/lib/api.ts`](src/lib/api.ts:2414)
  mapping to `goal_requests` collection with `pendingStatuses: ['pending']` and
  `actorField: 'childId'`.
- Contribution requests (when gated) and withdrawal requests surface as pending
  cards; parents approve/reject inline.
- Approving a withdrawal triggers §5.4; approving a gated contribution triggers
  the apply step of §5.1.
- **Manual match proposals** (`match_proposals`, §2.7) surface as a distinct
  Approval Center card. A selected parent approves or rejects (§5.3). Approval
  credits the `manual_match` exactly once; rejection leaves the child contribution
  unchanged. The proposal card shows the immutable `sourceContributionId` and
  `proposedMatchAmountPence`.
- Cancellation reuses `cancelPendingApproval` (already supports the
  `PendingApprovalKind` matrix).

---

## 9. Notification Flows

Reuse the closed `NotificationType` set in
[`src/lib/notifications.ts`](src/lib/notifications.ts:37) by adding new types:

- `goal_contribution` (child→parent: "X contributed £Y to Goal")
- `goal_parent_contribution` (parent→family: "Parent added £Y to Goal")
- `goal_withdrawal_requested` (child→parent)
- `goal_withdrawal_approved` (parent→child)
- `goal_reached` (parent→family when `currentAmountPence >= targetAmountPence`)
- `goal_purchased` (parent→family)
- `goal_returned` (parent→each child + family)

Each notification is built with `buildNotificationData` + a stable `dedupeKey`
(e.g. `goalContributionKey(contribId)`) so retries are idempotent. The existing
Cloud Function [`functions/src/index.ts`](functions/src/index.ts:58)
`onNotificationCreated` already delivers pushes via
[`functions/src/pushDelivery.ts`](functions/src/pushDelivery.ts:1) with `dryRun`
in the emulator — **no change to push behaviour required**. In-app delivery uses
the existing `notifications` collection + realtime listener.

---

## 10. UI Structure

- **Route:** add `/goals` (and `/goals/:goalId`) to
  [`src/App.tsx`](src/App.tsx:48), reusing `AppLayout`.
- **GoalsDashboard** page: lists family goals + the current child's goals;
  "Create Goal" button (parent only). Reuses `CurrencyDisplay`
  ([`src/components/ui/CurrencyDisplay`](src/components/ui/CurrencyDisplay)) and
  `formatMoney` ([`src/lib/walletPresentation.ts`](src/lib/walletPresentation.ts:62)).
- **GoalDetail** page: progress bar (`currentAmountPence / targetAmountPence`),
  contributor breakdown (ownership), immutable ledger view, and action buttons:
  - Child: "Contribute" (modal → wallet→goal, optional approval),
    "Request withdrawal" (bounded by `netChild`).
  - Parent: "Contribute (external)", "Set matching", "Approve requests",
    "Mark as purchased", "Return funds to wallets", "Cancel".
  - The contribution breakdown panel derives from the goal-specific
    `contributions` ledger (§2.2, §7), grouped by `type`/`ownerId` — **not** from
    `wallet_transactions`. It shows child contributions, parent external
    contributions, automatic matches, manual matches, child withdrawals,
    completion refunds, and external contribution closures.
  - The two explicit completion actions are preserved as distinct buttons:
    **"Mark as purchased"** (§5.5) and **"Return funds to wallets"** (§5.6). They
    are not merged into a single generic claim action.
- **Modals:** `GoalContributeModal`, `GoalWithdrawModal`, `GoalMatchModal`,
  `GoalCompleteModal` — follow the `PetBoxConfirmationModal`
  ([`src/components/funds/PetBoxConfirmationModal.tsx`](src/components/funds/PetBoxConfirmationModal.tsx:46))
  and `SendMoneyModal` patterns.
- **Approval Center:** goal requests appear automatically via the new adapter;
  `match_proposals` appear as a distinct manual-match approval card (§8). No new
  approval screen needed beyond these two cards.
- **Store:** extend [`src/store/useStore.ts`](src/store/useStore.ts:68)
  `savingsGoals` (rename concept to `goals`) and add `goalContributions`,
  `goalLedger`, `goalRequests` subscriptions; extend
  [`src/lib/bootstrapQueries.ts`](src/lib/bootstrapQueries.ts:182) accordingly.

---

## 11. Firestore Rules

Add a `match /goals/{goalId}` block (reusing `savings_goals` collection — see §13)
plus `contributions`, `goal_ledger`, `goal_requests`, `match_proposals`
subcollections. Follow the existing validator style: `isValidGoalCreate`,
`isValidGoalUpdate`, `isValidGoalContributionCreate`, `isValidGoalRequestCreate`,
`isValidGoalRequestApproval`, `isValidGoalLedgerCreate` (append-only),
`isValidMatchProposalCreate`, `isValidMatchProposalApproval`, using
`diff().affectedKeys().hasOnly(...)` and `getAfter(...)` cross-document checks
(mirrors [`isValidPetBoxApproval`](firestore.rules:903) and
[`isValidTransferApproval`](firestore.rules:726)).

> **Scope discipline (correction):** This feature adds **focused Goals rules and
> trusted transaction APIs only.** The existing wallet, transfer, Pet Box, and
> other financial validators in `firestore.rules` are **outside this feature's
> scope and must remain unchanged** unless a specific test proves they must
> change. Do **not** broadly delete or rewrite existing validators.

Key constraints:

- `goals` create: `isParent` (or child self-scoped legacy), `balance == 0`,
  integer pence fields, `status == 'active'`, `createdAt == request.time`.
- `goals` update: deny any `currentAmountPence` change unless the transaction
  shape is an approved contribution/return (validated via `getAfter` of the
  linked `contributions`/`wallet_transactions`); deny status change to terminal
  unless `isParent`; allow `reached → active` when a withdrawal reduces the
  balance below target (§5.4).
- `contributions` / `goal_ledger`: create-only, validated against the parent goal
  and (for returns) the child wallet; update/delete `if false`.
- `goal_requests`: child create bounded by ownership; parent update only
  `pending→approved|rejected` with reviewer identity + `request.time` + allowed
  field set; delete `if false`.
- `match_proposals`: system-created (`proposed`) by the trusted transaction; only
  parents/owners may transition `proposed → approved|rejected`; the
  `sourceContributionId` and `proposedMatchAmountPence` fields are immutable
  (deny any change on update).
- Preserve the **existing** `savings_goals` rule block and all other existing
  financial validators during migration (§13) so legacy docs keep working until
  migrated.

---

## 12. Error Handling

- `Insufficient funds` — child contribution exceeds wallet balance.
- `Goal not in active/reached state` — money action on a terminal goal
  (`completed_purchased` / `completed_returned` / `cancelled`).
- `Not pending` — approving/rejecting a non-pending request or match proposal.
- `Withdrawal exceeds owned contribution` — requested > `netChild(child)`.
- `Not authenticated` — `requireActorId()` guard (mirrors
  [`src/lib/api.ts`](src/lib/api.ts:52)).
- `Permission denied` — non-parent attempts parent action (rules + API guard).
- `Idempotency key conflict` — a reused idempotency key whose `requestHash`
  differs from the stored one is rejected (no partial write).
- `Already processed` — idempotent replay with matching `requestHash` returns the
  prior result, no new writes.
- All errors are surfaced through the existing `mapApprovalError` /
  `transactionErrors` patterns; UI shows friendly copy, never raw enums.

---

## 13. Migration & Backward Compatibility

The existing `savings_goals` collection
([`src/lib/api.ts`](src/lib/api.ts:1138), rules at
[`firestore.rules`](firestore.rules:1055)) already stores
`childId, title, targetAmount, currentAmount, createdAt`. The new feature
**reuses this collection** as `goals`:

- New code writes the full v1 shape (§2.1) including `targetAmountPence`,
  `currentAmountPence`, `kind`, `status`, `matching`, `currency`, `version`.
- A one-time migration script (emulator-safe, idempotent) backfills
  `targetAmountPence = round(targetAmount*100)`, `currentAmountPence = round(currentAmount*100)`,
  `kind = childId ? 'child' : 'family'`, `status = 'active'`, `currency = 'GBP'`,
  `version = 1` for legacy docs. It does **not** delete old fields.
- Reads tolerate both legacy (`targetAmount`) and v1 (`targetAmountPence`) shapes
  via a normalisation helper (single place, like `signedTransactionAmount`).
- The old `createSavingsGoal`/`updateSavingsGoal`/`deleteSavingsGoal` API remains
  functional; new code routes through the v1 API. No breaking change to existing
  callers (e.g. any UI still using `savingsGoals`).
- `firestore.rules` keeps the legacy `savings_goals` block and adds the new
  `goals` validators; both point at the same collection path during transition.

---

## 14. Concurrency

- Every money-moving operation uses `runTransaction` with optimistic concurrency
  (Firestore retries on contention).
- **Atomic idempotency (correction):** every money-moving operation writes a
  deterministic **idempotency operation document** at
  `families/{familyId}/idempotency/{key}`:

  ```
  {
    operationType: string,   // e.g. 'goal_contribution', 'goal_return', 'manual_match_approve'
    actorId: string,         // uid performing the action
    requestHash: string,     // stable hash of the normalised request payload
    status: 'completed',     // no separate 'processing' state is ever persisted
    resultRef: string,       // path to the primary created document
    createdAt: timestamp,
    expiresAt: timestamp      // TTL, e.g. +24h
  }
  ```

  The idempotency record and **every related financial write** (wallet balance,
  goal `currentAmountPence`, `contributions`, `goal_ledger`, `match_proposals`)
  are completed in the **same** `runTransaction`. There is no intermediate
  `processing` state: a failed transaction leaves no idempotency record behind.
  - On retry with the **same** `key` and **same** `requestHash`: the transaction
    finds `status: 'completed'` and returns `resultRef` without re-applying.
  - On retry with the **same** `key` but a **different** `requestHash`: the
    transaction **rejects** the call (idempotency key conflict) — it never
    silently applies a different logical action under a reused key.
- **Reads-before-writes / zero-read write stage** prevents lost updates.
- **Cross-document consistency** (wallet ↔ goal ↔ contributions) is enforced
  inside one transaction; rules use `getAfter` to reject partial writes.
- High-contention scenarios (many children contributing to one family goal)
  rely on Firestore transaction retries; operations are kept small and
  single-roundtrip where possible.

---

## 15. Testing

TDD-first, matching the repo convention (see
[`docs/superpowers/sdd`](../../docs/superpowers/sdd)). Three layers:

1. **Unit / API (vitest, `npm run test`):** pure helpers — `netChild` computation,
   match calculation (`floor/perX*matchY`, cap), idempotency key derivation,
   currency/normalisation, request-model adapter for `'goal'`.
2. **Firestore rules (emulator, `npm run test:rules`):** every validator in §11 —
   child contribution atomicity, insufficient funds denial, locked-fund denial,
   parent-only completion, withdrawal bounded by `netChild`, append-only ledger,
   idempotent replay, legacy `savings_goals` compatibility.
3. **Component / e2e (vitest + playwright, `npm run test:e2e`):** GoalsDashboard
   render, contribute modal → approval center → approve → wallet/goal update,
   withdrawal request → approve → refund, mark purchased, return funds (per-child
   separate refund), notification rows + push dry-run in emulator.

Exact tests and commands are enumerated in the implementation plan.

---

## 16. v1 Exclusions

- Full i18n / localisation (reuse `formatMoney` + `familyData.currency` only).
- Recurring / scheduled auto-contributions.
- Interest accrual or non-integer matching ratios.
- Goal categories/tags beyond family/child.
- Parent wallet or any parent-held balance.
- Editing a goal's currency after creation (set at create; migration default GBP).
- Any deployment or CI changes beyond running existing test suites.
- Changes to the auth bootstrap or push notification delivery behaviour.
