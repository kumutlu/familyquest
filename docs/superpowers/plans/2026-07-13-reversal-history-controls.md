# Reversal History Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live, parent/owner-only cancel/reverse/refund controls and reversal audit metadata to relevant histories and details.

**Architecture:** Normalize all source records through a pure history-action resolver, subscribe to immutable reversal records in the central store, and use one reusable modal/control across existing UI surfaces. Firestore APIs and rules remain the financial authority.

**Tech Stack:** React 19, TypeScript, Zustand, Firebase Firestore, Vitest, Testing Library.

## Global Constraints

- Exact warning: “This creates a linked reversal record. The original action will remain in history.”
- Trimmed reversal reason must contain at least 3 characters.
- Parent/owner controls only; no nested reversal; no action for legacy, unsupported, or already-reversed sources.
- Failed actions retain the modal and reason; duplicate submissions are synchronously blocked.

---

### Task 1: Normalized reversal history model

**Files:**
- Create: `src/lib/reversalHistory.ts`
- Test: `src/lib/reversalHistory.test.ts`

**Interfaces:**
- Produces: `normalizeHistoryAction(input): HistoryAction` and `findReversal(reversals, sourceKind, sourceId)`.
- Consumes: canonical `EffectSnapshot`, current balances, role, source kind/id, and reversal records.

- [ ] Write failing tests for supported source kinds, signed inverse preview, pending cancel, legacy/unsupported/already-reversed hiding, and reversal metadata.
- [ ] Run `npx vitest run src/lib/reversalHistory.test.ts` and observe missing-module failure.
- [ ] Implement the discriminated normalized model and eligibility resolver.
- [ ] Rerun the focused test and confirm all cases pass.

### Task 2: Reversal store subscription

**Files:**
- Modify: `src/lib/bootstrapQueries.ts`
- Modify: `src/store/useStore.ts`
- Modify: `tests/store/useStore.test.ts`

**Interfaces:**
- Produces: `useStore().reversals` populated from `families/{familyId}/reversals`.

- [ ] Add failing store tests asserting the query-plan resource, live snapshot update, and cleanup reset.
- [ ] Run the focused store tests and observe missing subscription/state failures.
- [ ] Add `reversals` to bootstrap resources, role plans, empty state, interface, and listener setup.
- [ ] Rerun store tests and confirm they pass.

### Task 3: Shared modal and control

**Files:**
- Create: `src/components/reversals/ReversalActionModal.tsx`
- Create: `src/components/reversals/ReversalActionModal.test.tsx`

**Interfaces:**
- Consumes: normalized `HistoryAction`, `reverseTransaction`, optional cancel callback, and close callback.
- Produces: accessible confirmation UI with validation, preview, warning, loading, exact error, and success callback.

- [ ] Add failing interaction tests for preview/copy, 3-character reason, synchronous double-submit guard, failed-action retention, exact error, and success close.
- [ ] Run focused tests and observe missing component failure.
- [ ] Implement the minimal modal workflow.
- [ ] Rerun focused tests and confirm they pass.

### Task 4: History/detail integrations

**Files:**
- Modify: `src/components/wallet/TransactionDetailsModal.tsx`
- Modify: `src/pages/Wallet.tsx`
- Modify: `src/components/funds/FundCard.tsx`
- Modify: `src/pages/MemberProfile.tsx`
- Modify: `src/components/parent/ApprovalCenter.tsx`
- Test: focused component tests next to affected components.

**Interfaces:**
- Consumes: `normalizeHistoryAction`, store reversals/balances/members, dispatcher, and existing cancellation APIs.

- [ ] Add failing component tests for role visibility, action labels, history badges/metadata, cancellation routing, immediate reversal snapshot reconciliation, and failure retention.
- [ ] Run focused tests and confirm expected failures.
- [ ] Integrate the shared action/modal into each relevant surface without duplicating eligibility logic.
- [ ] Rerun focused tests and confirm all pass.

### Task 5: Verification and report

**Files:**
- Modify: `.superpowers/sdd/stabilization-reversals-implementation.md`

- [ ] Record the final action matrix, UI behavior, TDD evidence, and exact test counts.
- [ ] Run focused reversal/store/component tests.
- [ ] Run `npx vitest run src tests/components tests/store tests/scripts`.
- [ ] Run JDK 21 `npm run test:rules`.
- [ ] Run scoped Oxlint and `npm run build`.
- [ ] Stage only Task D files, run `git diff --cached --check`, and commit.
