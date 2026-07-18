# Reversal Integrity Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every blocking reversal review finding with canonical, atomic, replay-proof reversals, exact reward inventory restoration, and audited immediately reconciled cancellations.

**Architecture:** Keep the existing Firestore client transaction, but make its source contract a shared TypeScript authority and mirror that closed matrix in rules. Make the reversal-record create depend on every exact after-state artifact, and make every inverse write depend on a record created in the same request. Extend immutable effect snapshots with reward inventory deltas and normalize cancellation audit metadata for both persisted and optimistic UI state.

**Tech Stack:** TypeScript, React, Zustand, Firebase Web SDK transactions, Firestore Security Rules, Vitest, Testing Library, Firebase Emulator Suite.

## Global Constraints

- Preserve lifetime XP; every reversal retains `xpAdjustment: 0` and `xpReversed: false`.
- Preserve the exact legacy-source error.
- Reversal records, events, and inverse ledgers remain deterministic and append-only.
- Cancellation changes no balance or effect snapshot.
- Preserve unrelated dirty-worktree changes and selectively stage overlapping page hunks.

---

### Task 1: Canonical source contract

**Files:**
- Modify: `src/lib/reversalContracts.ts`
- Modify: `src/lib/reversalApi.ts`
- Test: `src/lib/reversalContracts.test.ts`
- Test: `src/lib/reversalApi.test.ts`

**Interfaces:**
- Produces: `assertCanonicalReversalSource(kind, sourceId, source)` returning a validated `EffectSnapshot`.
- Consumes: the existing `ReversalSourceKind` and exact legacy error behavior.

- [ ] Add failing table tests for derived transfer/money/Pet Box ledger snapshots, prior reversal ledgers, wrong entity types, wrong request linkage, and nonterminal task/request states.
- [ ] Run `npx vitest run src/lib/reversalContracts.test.ts src/lib/reversalApi.test.ts` and confirm the new cases fail because the dispatcher currently accepts them.
- [ ] Implement the closed entity/state/type matrix and call it before the dispatcher reads effect targets.
- [ ] Rerun the focused tests and confirm all canonical and legacy cases pass.

### Task 2: Exact reward redemption and reversal

**Files:**
- Modify: `src/lib/reversalContracts.ts`
- Modify: `src/lib/reversalDomain.ts`
- Modify: `src/lib/reversalApi.ts`
- Modify: `src/lib/api.ts`
- Selectively modify: `src/pages/Rewards.tsx`
- Test: `src/lib/api.approvals.test.ts` or a focused reward API test
- Test: `src/lib/reversalDomain.test.ts`
- Test: `src/lib/reversalApi.test.ts`

**Interfaces:**
- Adds optional `rewardInventoryDelta` to `EffectSnapshot`, `rewardInventory` and `inverseRewardInventoryDelta` to reversal planning, and a reward after-state update keyed by `lastReversalId`.

- [ ] Add failing tests proving finite inventory is decremented in the redemption transaction, unlimited inventory is untouched, and reversal restores the exact finite delta atomically.
- [ ] Run those tests and confirm failure from the separate page-level inventory update and absent reversal inventory handling.
- [ ] Move finite inventory validation/decrement into `redeemReward`, snapshot `rewardInventoryDelta: -1`, extend inverse planning, read/update the reward in `reverseTransaction`, and remove only the redundant page update.
- [ ] Rerun focused reward/domain/dispatcher tests and confirm pass.

### Task 3: Atomic and replay-proof Firestore reversal rules

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore/reversal.rules.test.ts`

**Interfaces:**
- `isValidReversalRecord` becomes the all-artifact transaction anchor.
- Wallet/fund/points/reward and ledger validators require `!exists(reversalPath)` before and `existsAfter(reversalPath)` after.

- [ ] Add failing emulator tests for record-only, missing event, each missing nonzero effect/ledger, altered effect, delayed inverse after record creation, replay after a valid reversal, derived approval legs, reversal ledgers, wrong entity types, wrong request IDs, ineligible states, and omitted/altered reward inventory restoration.
- [ ] Run the focused reversal rules suite on JDK 21 and verify each new denial fails for the intended permissive rule.
- [ ] Implement canonical source helpers, exact event/effect/ledger after-state checks from the record rule, same-request record creation requirements in every effect validator, and exact reward inventory update validation.
- [ ] Rerun focused rules until every valid batch succeeds and every adversarial batch is denied.

### Task 4: Audited cancellation API and rules

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `firestore.rules`
- Test: `src/lib/api.approvals.test.ts`
- Test: `tests/firestore/approvalCenter.rules.test.ts`

**Interfaces:**
- Changes `cancelPendingApproval(familyId, kind, requestId, reason)` to return audit data and persist `cancellationReason`, `cancelledBy`, `cancelledByName`, and `cancelledAt`.

- [ ] Add failing API table tests for all four cancellation families, trimmed reason, authenticated display name, and rejection of blank reasons.
- [ ] Add failing emulator cases requiring the exact reason/actor/name/time fields and denying altered or missing audit fields for task, transfer, both money states, and Pet Box.
- [ ] Run focused API/rules tests and confirm the current reason-discarding implementation fails.
- [ ] Implement the API payload and shared exact cancellation rule predicate without permitting financial/source-field changes.
- [ ] Rerun focused tests and confirm pass.

### Task 5: Immediate cancellation reconciliation

**Files:**
- Modify: `src/lib/reversalHistory.ts`
- Modify: `src/components/reversals/HistoryActionControl.tsx`
- Modify: `src/components/reversals/ReversalHistoryPanel.tsx`
- Test: `src/lib/reversalHistory.test.ts`
- Test: `src/components/reversals/HistoryActionControl.test.tsx`
- Test: `src/components/reversals/ReversalHistoryPanel.test.tsx`

**Interfaces:**
- Adds normalized `cancellation` audit metadata and optimistic overlays keyed by `sourceKind:sourceId`.

- [ ] Add failing tests that the row control immediately shows Cancelled plus reason/actor/time and that consolidated history retains the cancelled row before and after listener reconciliation.
- [ ] Run focused component tests and confirm failure because current state stores only a boolean and the panel drops cancelled rows.
- [ ] Pass the reason into the API, store optimistic audit objects, normalize persisted cancellation metadata, include cancellation in panel filtering/rendering, and replace optimism when source state arrives.
- [ ] Rerun focused normalization/component tests and confirm pass.

### Task 6: Final evidence, report, commit, and review

**Files:**
- Modify: `.superpowers/sdd/stabilization-reversals-implementation.md`
- Modify: `.superpowers/sdd/stabilization-reversals-review.md` only after independent final verdict if requested by reviewer handoff.

- [ ] Run focused reversal/API/component tests and record exact counts.
- [ ] Run `npx vitest run --exclude 'tests/firestore/**'` and record exact counts.
- [ ] Run `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home/bin:$PATH npm run test:rules` and record exact counts.
- [ ] Run `npm run lint` and `npm run build`; record errors separately from advisory warnings.
- [ ] Update the implementation report/action matrix with the exact authority, inventory, cancellation, and test evidence.
- [ ] Inspect the staged diff for unrelated files, secrets, debug artifacts, and whitespace; commit the implementation.
- [ ] Dispatch an independent read-only review across the design/plan/implementation range and fix all Critical or Important findings before handoff.
