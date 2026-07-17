# Family Fund & Goals — Implementation Plan

**Date:** 2026-07-17
**Status:** Plan (no implementation performed)
**Companion design:** [`../specs/2026-07-17-family-fund-goals-design.md`](../specs/2026-07-17-family-fund-goals-design.md)

This plan is TDD-first and checkpointed. Each phase lists the exact files to
create/modify, the small TDD tasks, the exact tests, the exact commands, and a
commit checkpoint. Implementation is **not** started here — this is the agreed
build order.

Conventions reused (do not reinvent):
- Atomic money ops: `runTransaction(db, ...)` with reads-before-writes and a
  zero-read write stage — [`src/lib/api.ts`](src/lib/api.ts:418).
- Notifications: `buildNotificationData` + `dedupeKey` + `loadNotificationRecipientsInTransaction` /
  `applyNotificationWrites` — [`src/lib/notifications.ts`](src/lib/notifications.ts:1).
- Approval Center: `PendingApprovalKind` + `cancelPendingApproval` —
  [`src/lib/api.ts`](src/lib/api.ts:2414).
- Rules validators: `diff().affectedKeys().hasOnly(...)` + `getAfter(...)` —
  [`firestore.rules`](firestore.rules:903).
- Tests: `npm run test` (vitest), `npm run test:rules` (firebase emulator),
  `npm run test:e2e` (playwright).

---

## Phase 0 — Scaffold & types (no behaviour yet)

**Create/modify:**
- `src/lib/goalContracts.ts` — pure types + helpers (no Firestore):
  - `GoalKind`, `GoalStatus` (`'active' | 'reached' | 'completed_purchased' | 'completed_returned' | 'cancelled'`), `MatchingPolicy`, `ContributionType` (`'child_contribution' | 'parent_contribution' | 'auto_match' | 'manual_match' | 'child_withdrawal' | 'completion_refund' | 'external_closure'`), `ContributionLeg`, `GoalRequest`, `GoalLedgerEntry`, `MatchProposal`.
  - `computeNetChild(contributions, childId): number` (§7 of design) — sums
    `child_contribution`, subtracts `child_withdrawal`/`completion_refund` for that
    owner; ignores parent/match/closure entries.
  - `computeMatchPence(childAmount, policy): number` (§6 — `floor(childAmount/perX)*matchY`, cap).
  - `normalizeGoalDoc(doc): Goal` (tolerates legacy `targetAmount`/`currentAmount`).
  - `requestHashOf(request): string` — stable hash of the normalised request payload
    for atomic idempotency (§14 of design).
  - `goalContributionKey`, `goalWithdrawalKey`, `goalMatchKey` idempotency key builders.
- `src/lib/goalContracts.test.ts` — unit tests for the pure helpers.

**Exact tests (goalContracts.test.ts):**
- `computeNetChild` sums only `child_contribution` for owner, subtracts
  `child_withdrawal`/`completion_refund` for that owner, ignores parent/match/closure.
- `computeMatchPence(100, {mode:'auto',perX:100,matchY:50}) === 50`; cap respected;
  `mode:'none'` → 0; `mode:'manual'` → 0 (manual applied explicitly via proposal).
- `normalizeGoalDoc` maps legacy `targetAmount:10` → `targetAmountPence:1000`,
  defaults `kind:'child'`, `status:'active'`, `currency:'GBP'`, `version:1`.
- `requestHashOf` is deterministic and differs for different payloads.
- idempotency keys are deterministic and unique per id.

**Commands:**
```
npm run test src/lib/goalContracts.test.ts
```

**Checkpoint:** commit `feat(goals): add goal contracts + pure helpers (tests only)`.

---

## Phase 1 — Data layer: API transactions

**Create/modify:**
- `src/lib/api.ts` — add (reuse `savings_goals` collection as `goals`):
  - `createGoal(familyId, input)` (parent or child self-scoped).
  - `updateGoal(familyId, goalId, updates)` (parent metadata only).
  - `contributeToGoal(familyId, goalId, childId, amountPence, opts)` — §5.1,
    atomic wallet↔goal, optional approval-gated, auto-match leg, manual-match
    proposal creation, `reached` transition.
  - `addParentGoalContribution(familyId, goalId, amountPence)` — §5.2 (external).
  - `requestGoalWithdrawal(familyId, goalId, childId, amountPence)` — §5.4 create.
  - `approveGoalWithdrawal(familyId, requestId)` / `rejectGoalWithdrawal(...)` —
    §5.4; may transition `reached → active`.
  - `completeGoalPurchased(familyId, goalId)` — §5.5 (`completed_purchased`).
  - `returnGoalFunds(familyId, goalId)` — §5.6 (per-child separate refund +
    `external_closure` + `currentAmountPence = 0`, `completed_returned`).
  - `cancelGoal(familyId, goalId)` — §5.7.
  - `createMatchProposal` / `approveMatchProposal` / `rejectMatchProposal` —
    §5.3 (explicit approval request; credits `manual_match` exactly once).
  - Register `'goal'` in `PendingApprovalKind` map (line ~2414) →
    `{ collectionName: 'goal_requests', pendingStatuses: ['pending'], actorField: 'childId' }`.
  - **Atomic idempotency helper:** every money-moving API writes the idempotency
    operation document (§14 of design) and all related financial writes in the
    **same** `runTransaction`; no `processing` state; reject on `requestHash`
    mismatch.
- `src/lib/api.goals.test.ts` — vitest with mocked `db`/`auth` OR emulator-backed
  tests mirroring `api.transfers.test.ts` / `api.fundExpense.test.ts`.

**Exact tests (api.goals.test.ts):**
- Child contribution debits wallet and credits goal by equal integer; wallet
  balance never negative; throws on insufficient funds; sets `reached` when
  `currentAmountPence >= targetAmountPence`.
- Parent contribution credits goal only (no wallet debit).
- Auto-match adds a parent-owned `auto_match` leg; `computeMatchPence` boundary
  (e.g. 250p with perX100/matchY50 → 100p, capped at capPence).
- Manual mode: contribution creates a `match_proposals` with immutable
  `sourceContributionId` + `proposedMatchAmountPence`; no match money yet.
- `approveMatchProposal` credits a `manual_match` exactly once; re-approval is
  idempotent; `rejectMatchProposal` leaves the child contribution unchanged.
- Withdrawal approval refunds exactly `netChild(child)`; rejects amount >
  `netChild`; parent/match money never returned; `reached → active` when balance
  drops below target.
- `returnGoalFunds` refunds each child separately to that child's wallet; parent +
  match legs closed via `external_closure` (no wallet credit); `currentAmountPence
  = 0`; status `completed_returned`.
- `completeGoalPurchased` sets `completed_purchased`, no wallet movement, locks
  further writes (subsequent contribute throws "Goal not in active/reached state").
- Atomic idempotency: replay with same key + same `requestHash` → no new writes;
  replay with same key + different `requestHash` → rejected; failed transaction
  leaves no idempotency record.
- Non-parent calling `completeGoalPurchased`/`returnGoalFunds`/`addParentGoalContribution`
  throws permission error.

**Commands:**
```
npm run test src/lib/api.goals.test.ts
```

**Checkpoint:** commit `feat(goals): atomic goal transactions + approval hooks`.

---

## Phase 2 — Firestore rules

**Create/modify:**
- `firestore.rules` — **add focused Goals rules and trusted transaction APIs
  only.** Add validators and `match` blocks for `goals` (reusing the
  `savings_goals` path), `goals/{goalId}/contributions`, `goals/{goalId}/goal_ledger`,
  `goals/{goalId}/goal_requests`, `goals/{goalId}/match_proposals`. **Do NOT delete
  or broadly rewrite the existing wallet, transfer, Pet Box, or other financial
  validators** — they are outside this feature's scope and must remain unchanged
  unless a specific test proves they must change. Keep the legacy `savings_goals`
  block intact during migration (design §13).
- `tests/firestore/goalRules.test.ts` — emulator rules tests (mirror
  `tests/firestore/*` patterns used by `npm run test:rules`).

**Exact tests (goalRules.test.ts):**
- Child can create `kind:'child'` scoped to self; cannot set `currentAmountPence != 0`.
- Parent can create family/child goals; child cannot create `kind:'family'`.
- Contribution create requires linked wallet_tx + goal doc with `status in
  {'active','reached'}` and matching integer deltas (via `getAfter`).
- Insufficient-funds contribution denied (wallet balance check in rules).
- `goal_ledger` / `contributions` are append-only (update/delete `if false`).
- Withdrawal request create bounded by ownership; approval only by parent with
  reviewer identity + `request.time` + allowed field set.
- `match_proposals`: system-created `proposed`; only parent/owner may transition
  `proposed → approved|rejected`; `sourceContributionId` and
  `proposedMatchAmountPence` immutable on update.
- Completion status change to terminal (`completed_purchased`/`completed_returned`/
  `cancelled`) denied for non-parent; `reached → active` allowed on withdrawal.
- Existing wallet/transfer/Pet Box validators are unchanged and still pass.
- Legacy `savings_goals` docs still pass the old rule block (backward compat).

**Commands:**
```
npm run test:rules
```

**Checkpoint:** commit `feat(goals): firestore rules for goals + subcollections`.

---

## Phase 3 — Notifications & Approval Center integration

**Create/modify:**
- `src/lib/notifications.ts` — add `NotificationType` members: `goal_contribution`,
  `goal_parent_contribution`, `goal_withdrawal_requested`, `goal_withdrawal_approved`,
  `goal_reached`, `goal_purchased`, `goal_returned`, `goal_match_proposed`,
  `goal_match_approved` (design §9). Add dedupe-key builders in
  `notificationDedupe.ts` (`goalContributionKey`, etc.).
- `src/lib/requestModel.ts` — add `'goal'` to `RequestCategory`; add adapter that
  normalises `goal_requests` into `NormalizedRequest` (title, amount, status,
  timeline). Reuse `formatAmount` ([`src/lib/requestModel.ts:119`](src/lib/requestModel.ts:119)).
- `src/lib/notifications.api.test.ts` or new `src/lib/notifications.goals.test.ts`
  — assert notification payloads + dedupe keys for each flow.
- `src/components/parent/ApprovalCenter.tsx` — the new `PendingApprovalKind` entry
  auto-surfaces goal requests. Add a `renderApprovalCard` branch for
  `category === 'goal'` (contribution/withdrawal copy + Approve/Reject). Add a
  **distinct manual-match proposal card** that shows the immutable
  `sourceContributionId` + `proposedMatchAmountPence` and calls
  `approveMatchProposal` / `rejectMatchProposal`. Add `ApprovalCenter.goal.test.tsx`
  asserting goal requests and match proposals render and approve/reject call the
  right API.

**Exact tests:**
- Each flow emits exactly one notification with stable `dedupeKey`; replay → no
  duplicate (idempotent).
- `requestModel` adapter yields correct `typeLabel`, `amountPence`, `statusKind`
  for contribution and withdrawal raw docs.
- `ApprovalCenter.goal.test.tsx`: goal withdrawal request shows "Waiting for
  approval"; clicking Approve calls `approveGoalWithdrawal`; child contribution
  (gated) shows and approves via `contributeToGoal` apply path; a `match_proposals`
  card shows the proposed amount and Approve calls `approveMatchProposal` (credits
  `manual_match` once), Reject calls `rejectMatchProposal` (child contribution
  unchanged).

**Commands:**
```
npm run test src/lib/notifications.goals.test.ts src/components/parent/ApprovalCenter.goal.test.tsx
```

**Checkpoint:** commit `feat(goals): notifications + approval center integration`.

---

## Phase 4 — Store & bootstrap

**Create/modify:**
- `src/store/useStore.ts` — add `goalContributions`, `goalLedger`, `goalRequests`,
  `goalMatchProposals` arrays + subscriptions (mirror `savingsGoals` at
  [`src/store/useStore.ts:584`](src/store/useStore.ts:584)); keep `savingsGoals`
  for backward compat or alias to `goals`. Add a `goalContributionBreakdown`
  selector that derives the UI breakdown from `goalContributions` (the goal ledger),
  **not** from `wallet_transactions`.
- `src/lib/bootstrapQueries.ts` — register `goalContributions`, `goalLedger`,
  `goalRequests`, `goalMatchProposals` resources + queries (mirror `savingsGoals` at
  [`src/lib/bootstrapQueries.ts:182`](src/lib/bootstrapQueries.ts:182)).
- `src/store/useStore.goals.test.tsx` — assert subscriptions populate from
  emulator/seeded data.

**Exact tests:**
- Store exposes goals + contributions + requests + match proposals after bootstrap;
  legacy `savingsGoals` data still loads; `goalContributionBreakdown` groups by
  `type`/`ownerId` from the goal ledger.

**Commands:**
```
npm run test src/store/useStore.goals.test.tsx
```

**Checkpoint:** commit `feat(goals): store + bootstrap wiring`.

---

## Phase 5 — UI

**Create/modify:**
- `src/App.tsx` — add routes `/goals` and `/goals/:goalId` (mirror
  [`src/App.tsx:48`](src/App.tsx:48)).
- `src/pages/GoalsDashboard.tsx` (new) — lists goals, "Create Goal" (parent),
  progress via `CurrencyDisplay` ([`src/components/ui/CurrencyDisplay`](src/components/ui/CurrencyDisplay)).
- `src/pages/GoalDetail.tsx` (new) — progress bar, contributor breakdown
  (ownership, derived from the goal `contributions` ledger via
  `goalContributionBreakdown`), immutable ledger, action buttons per role.
- `src/components/goals/GoalContributeModal.tsx`, `GoalWithdrawModal.tsx`,
  `GoalMatchModal.tsx`, `GoalCompleteModal.tsx` (new) — follow
  `PetBoxConfirmationModal`
  ([`src/components/funds/PetBoxConfirmationModal.tsx:46`](src/components/funds/PetBoxConfirmationModal.tsx:46))
  and `SendMoneyModal` patterns.
- `src/pages/GoalsDashboard.test.tsx`, `src/pages/GoalDetail.test.tsx`,
  `src/components/goals/*.test.tsx` — render + interaction tests (mock API).

**Exact tests:**
- Dashboard lists family + own goals; parent sees Create, child does not.
- Contribute modal calls `contributeToGoal` with integer pence; shows
  insufficient-funds error.
- Withdraw modal max = `netChild(child)`; submit creates withdrawal request.
- Parent detail shows **two distinct** completion actions: "Mark as purchased"
  (§5.5) and "Return funds to wallets" (§5.6). Return refunds per child to that
  child's own wallet (assert two separate wallet credits via mocked API calls);
  parent/match money is closed via `external_closure`, not credited to a wallet.
- Contribution breakdown panel derives from the goal `contributions` ledger
  (child contributions, parent external, auto/manual matches, withdrawals,
  completion refunds, external closures) — not from `wallet_transactions`.
- Goal reached notification row appears when `currentAmountPence >= targetAmountPence`.

**Commands:**
```
npm run test src/pages/GoalsDashboard.test.tsx src/pages/GoalDetail.test.tsx src/components/goals
```

**Checkpoint:** commit `feat(goals): dashboard, detail, modals, routes`.

---

## Phase 6 — Migration script (emulator-safe, idempotent)

**Create:**
- `scripts/migrate-goal-fields.ts` — backfills legacy `savings_goals` docs with
  `targetAmountPence`, `currentAmountPence`, `kind`, `status`, `currency:'GBP'`,
  `version:1` (design §13). Idempotent: skips docs that already have `version`.
- `scripts/migrate-goal-fields.test.ts` — runs against emulator, asserts legacy
  doc gets v1 fields and re-run is a no-op.

**Commands:**
```
npx tsx scripts/migrate-goal-fields.ts   # emulator must be running
npm run test scripts/migrate-goal-fields.test.ts
```

**Checkpoint:** commit `feat(goals): idempotent legacy field migration`.

---

## Phase 7 — End-to-end & final verification

**Create/modify:**
- `tests/e2e/goalFlow.spec.ts` (playwright) — full flow: parent creates family
  goal with auto-match → child contributes from wallet → parent approves (if
  gated) → goal reached notification → parent returns funds → each child wallet
  credited separately (parent/match money closed via `external_closure`, not
  wallet-credited) → ledger immutable. A second scenario covers manual matching:
  child contribution creates a `match_proposals` entry → parent approves in
  Approval Center → `manual_match` credited exactly once → rejection leaves the
  child contribution unchanged. A third scenario asserts atomic idempotency: a
  retried client call with the same key + `requestHash` produces no duplicate
  writes; a different `requestHash` under the same key is rejected.

**Exact final verification commands (run in order):**
```
npm run test                                  # full vitest unit/api suite
npm run test:rules                             # full firestore rules suite
npm run test:e2e                               # playwright e2e (emulator)
npx tsc --noEmit -p tsconfig.json              # type check
npx oxlint src scripts                         # repo lint (.oxlintrc.json)
npm run build                                  # production build (no deploy)
```

All must pass. No deployment, no auth/push behaviour changes.

**Checkpoint:** commit `feat(goals): e2e + final verification green`.

---

## File summary

| Action | Path |
|---|---|
| create | `src/lib/goalContracts.ts` |
| create | `src/lib/goalContracts.test.ts` |
| modify | `src/lib/api.ts` |
| create | `src/lib/api.goals.test.ts` |
| modify | `firestore.rules` |
| create | `tests/firestore/goalRules.test.ts` |
| modify | `src/lib/notifications.ts` |
| modify | `src/lib/notificationDedupe.ts` |
| modify | `src/lib/requestModel.ts` |
| create | `src/lib/notifications.goals.test.ts` |
| modify | `src/components/parent/ApprovalCenter.tsx` |
| create | `src/components/parent/ApprovalCenter.goal.test.tsx` |
| modify | `src/store/useStore.ts` |
| modify | `src/lib/bootstrapQueries.ts` |
| create | `src/store/useStore.goals.test.tsx` |
| modify | `src/App.tsx` |
| create | `src/pages/GoalsDashboard.tsx` + `.test.tsx` |
| create | `src/pages/GoalDetail.tsx` + `.test.tsx` |
| create | `src/components/goals/GoalContributeModal.tsx` + `.test.tsx` |
| create | `src/components/goals/GoalWithdrawModal.tsx` + `.test.tsx` |
| create | `src/components/goals/GoalMatchModal.tsx` + `.test.tsx` |
| create | `src/components/goals/GoalCompleteModal.tsx` + `.test.tsx` |
| create | `scripts/migrate-goal-fields.ts` |
| create | `scripts/migrate-goal-fields.test.ts` |
| create | `tests/e2e/goalFlow.spec.ts` |

No application code was modified during planning. This plan is ready for a
follow-up implementation task.
