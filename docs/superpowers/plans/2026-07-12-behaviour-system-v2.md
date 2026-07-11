# FamilyQuest Behaviour System V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic positive, negative, and financial behavior events with family debt limits, immutable wallet-ledger links, read-only child history, and consistent negative-balance presentation.

**Architecture:** Pure domain helpers own validation and balance calculations; the existing Firebase API composes those helpers inside one Firestore transaction that updates a child and creates all audit records atomically. Existing Zustand subscriptions and screens consume normalized V1/V2 history models, while Firestore rules independently enforce parent/owner-only writes.

**Tech Stack:** React 19, TypeScript 6, Firebase/Firestore 12, Zustand 5, Vitest, Testing Library, Firebase Rules Unit Testing, Tailwind CSS 4.

## Global Constraints

- Reuse the existing behavior event collection and wallet ledger; do not create a punishment module.
- Financial values are integer pence at rest.
- Family debt limit is `debtLimitPence`, defaults to `-5000`, and applies family-wide.
- Positive events increase `rewardPoints` and `lifetimeXP`.
- Negative events reduce only `rewardPoints`, clamp at zero, and store only the applied delta.
- Financial events affect only `walletBalance` and create a linked immutable `financial_penalty` ledger entry.
- Parent/owner can create; children can read history but cannot write points, wallet balances, behavior events, or ledger entries.
- All history is newest first, normalizing V1 `timestamp` and V2 `createdAt`.
- Preserve unrelated existing dirty-worktree changes and do not overwrite them.

---

## File Map

- Create `src/lib/behaviour.ts`: event types, pure validation/calculation, compatibility normalization, and history sorting.
- Create `src/lib/money.ts`: signed currency formatting and negative-balance class selection.
- Create `src/lib/behaviour.test.ts`, `src/lib/money.test.ts`: domain unit tests.
- Create `src/components/behaviour/BehaviourEventModal.tsx` and test: parent form and error handling.
- Create `src/components/behaviour/BehaviourHistory.tsx` and test: shared V1/V2 history rendering.
- Modify `src/lib/api.ts`: atomic event transaction and audited debt-limit update.
- Modify `src/store/useStore.ts`: subscribe without incompatible field-specific ordering, normalize, and sort mixed history.
- Modify `firestore.rules`: append-only event validation and child balance/point protection.
- Create `tests/firestore/behaviour.rules.test.ts`: emulator-backed role and shape tests.
- Modify `src/components/parent/ParentDashboard.tsx`, `src/pages/MemberProfile.tsx`, `src/pages/Settings.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Wallet.tsx`, `src/pages/FundsDashboard.tsx`, and wallet selectors: integrate V2 UI.
- Modify `package.json`, `package-lock.json`, `vite.config.ts`: test tooling and scripts.

---

### Task 1: Domain Models and Validation Helpers

**Files:**
- Create: `src/lib/behaviour.ts`
- Create: `src/lib/behaviour.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `BehaviourEventType`, `BehaviourEventInput`, `validateBehaviourInput(input)`, `calculateBehaviourEffect(input, balances, debtLimitPence)`, `normalizeBehaviourEvent(raw)`, and `sortNewestFirst(items)`.

- [ ] **Step 1: Install and configure the test runner**

Run: `npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @firebase/rules-unit-testing firebase-tools`

Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, and `"test:rules": "firebase emulators:exec --only firestore 'vitest run tests/firestore'"`. Configure Vitest for `jsdom`, globals, and a setup file importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write failing domain tests**

Cover exact sign/zero rules, trimmed reason length, finite integer deltas, positive XP, negative clamp with applied-only delta, exact debt-limit acceptance, below-limit rejection, financial isolation, V1 field normalization, and mixed timestamp sorting. Representative assertions:

```ts
expect(calculateBehaviourEffect(
  { type: 'negative', reason: 'Late home', pointsDelta: -25, walletDelta: 0 },
  { rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 },
  -5000,
)).toEqual({ rewardPoints: 0, lifetimeXP: 100, walletBalance: 0, pointsDelta: -10, walletDelta: 0 });

expect(() => calculateBehaviourEffect(
  { type: 'financial', reason: 'Broken item', pointsDelta: 0, walletDelta: -1501 },
  { rewardPoints: 10, lifetimeXP: 100, walletBalance: -3500 },
  -5000,
)).toThrow('This penalty would exceed the family debt limit.');
```

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- src/lib/behaviour.test.ts`

Expected: FAIL because `src/lib/behaviour.ts` does not exist.

- [ ] **Step 4: Implement minimal pure helpers**

Use discriminated event types, `DEFAULT_DEBT_LIMIT_PENCE = -5000`, `Math.max(0, rewardPoints + pointsDelta)`, and compute applied negative delta as `nextRewardPoints - rewardPoints`. Normalize `createdAt ?? timestamp`, `childId ?? userId`, `reason ?? title`, and `createdBy ?? authorId` without mutating stored data.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/lib/behaviour.test.ts && npm run build`

Expected: all domain tests PASS and TypeScript build succeeds.

Commit: `git commit -m "test: define behaviour v2 domain rules"`

---

### Task 2: Atomic Behaviour Transaction Service and Settings Audit

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/api.behaviour.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `addBehaviourEvent(familyId, childId, createdBy, input): Promise<string>` and `updateDebtLimit(familyId, ownerId, debtLimitPence): Promise<void>`.

- [ ] **Step 1: Write failing transaction-contract tests**

Mock only the Firestore adapter boundary and assert one `runTransaction` callback creates preallocated event/ledger refs, reads family/child/creator, and writes:

```ts
expect(eventWrite).toMatchObject({
  familyId: 'family-1', childId: 'child-1', type: 'financial',
  reason: 'Broken headphones', pointsDelta: 0, walletDelta: -500,
  createdBy: 'owner-1', createdByName: 'Kemal',
});
expect(ledgerWrite).toMatchObject({
  type: 'financial_penalty', behaviourEventId: eventId,
  childId: 'child-1', amount: 500, reason: 'Broken headphones',
  createdBy: 'owner-1', createdByName: 'Kemal',
});
```

Also assert no ledger write for point events, negative stores applied delta, creator/child must belong to the family, target role must be child, and `updateDebtLimit` writes `{debtLimitPence, updatedBy, updatedAt}`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/lib/api.behaviour.test.ts`

Expected: FAIL because the V2 API and write shapes do not exist.

- [ ] **Step 3: Implement the single transaction**

Preallocate `eventRef` and financial-only `ledgerRef` before `runTransaction`. Inside the callback read the family, child, and creator; validate roles/membership and domain input; update only the affected child fields; write the event with `createdAt: serverTimestamp()`; write the linked ledger entry; and write the existing feed entry using both `createdAt` and legacy `timestamp` during compatibility. Return `eventRef.id`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/lib/behaviour.test.ts src/lib/api.behaviour.test.ts && npm run build`

Expected: PASS.

Commit: `git commit -m "feat: add atomic behaviour v2 transactions"`

---

### Task 3: Firestore Security Rules

**Files:**
- Modify: `firestore.rules`
- Create: `tests/firestore/behaviour.rules.test.ts`

**Interfaces:**
- Enforces the same role, immutable-ledger, allowed-key, and event-shape contract as Tasks 1–2.

- [ ] **Step 1: Write failing emulator tests**

Seed owner, parent, child, other-family user, and family documents through the rules-disabled context. Use `assertSucceeds`/`assertFails` to cover family reads, parent/owner valid creates, child creates, cross-family creates, wrong delta signs, short reasons, forged creator IDs/names, event update/delete, financial ledger creation with/without `behaviourEventId`, ledger update/delete, and child direct changes to `rewardPoints`, `lifetimeXP`, or `walletBalance`.

- [ ] **Step 2: Verify RED**

Run: `npm run test:rules`

Expected: FAIL because current rules allow broad behavior writes and child point changes.

- [ ] **Step 3: Implement rule predicates**

Add helpers for `isParent`, exact allowed keys, child membership/role, event sign rules, creator identity, and immutable creates. Change behavior events to `allow create` only for parent/owner and deny update/delete. Keep ledger immutable and validate the financial-penalty subtype. Remove child self-update access to all three balance fields.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm run test:rules`

Expected: all emulator tests PASS.

Commit: `git commit -m "security: enforce behaviour v2 writes"`

---

### Task 4: Parent/Owner Behaviour Modal and Debt-Limit Setting

**Files:**
- Create: `src/components/behaviour/BehaviourEventModal.tsx`
- Create: `src/components/behaviour/BehaviourEventModal.test.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `addBehaviourEvent`, `updateDebtLimit`.
- Produces: a role-gated modal that submits signed integer deltas and an owner-only family debt-limit form.

- [ ] **Step 1: Write failing UI tests**

Render each event type and assert only the relevant input appears; points/money magnitude converts to negative delta; reason requires three characters; debt-limit errors remain visible; submit closes only after success; child role has no create control; owner settings convert `50.00` to `-5000` and pass the owner ID.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/behaviour/BehaviourEventModal.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement minimal UI**

Extract the current inline modal, use radio buttons for the three types, keep magnitude inputs positive at the UI boundary, add `minLength={3}`, disable duplicate submissions, and render caught error messages. Show debt-limit settings only for `role === 'owner'`; parents inherit but cannot edit the limit.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/components/behaviour/BehaviourEventModal.test.tsx && npm run build`

Expected: PASS.

Commit: `git commit -m "feat: add behaviour v2 parent controls"`

---

### Task 5: History Rendering and Newest-First Compatibility

**Files:**
- Create: `src/components/behaviour/BehaviourHistory.tsx`
- Create: `src/components/behaviour/BehaviourHistory.test.tsx`
- Modify: `src/pages/MemberProfile.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/pages/Wallet.tsx`
- Modify: `src/store/useStore.ts`

**Interfaces:**
- Consumes: normalized events and mixed `createdAt`/`timestamp` records.
- Produces: shared newest-first event cards and financial-ledger rows.

- [ ] **Step 1: Write failing rendering tests**

Assert positive/negative/financial icons and colors, signed point/currency output, reason, date, creator snapshot, child filtering, newest-first order, V1 fallback fields, `financial_penalty` ledger labels, and `createdAt ?? timestamp` dates.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/components/behaviour/BehaviourHistory.test.tsx`

Expected: FAIL because shared history rendering does not exist.

- [ ] **Step 3: Implement history and subscriptions**

Render one shared component in child profiles and family/parent history. Subscribe to behavior events, feed, and wallet transactions without a single-field `orderBy` that excludes compatibility documents; normalize and sort in memory by `createdAt ?? timestamp`, descending. Limit only after sorting.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/lib/behaviour.test.ts src/components/behaviour/BehaviourHistory.test.tsx && npm run build`

Expected: PASS.

Commit: `git commit -m "feat: render behaviour v2 history"`

---

### Task 6: Negative Balance Formatting and Styling

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/pages/Wallet.tsx`
- Modify: `src/pages/MemberProfile.tsx`
- Modify: `src/pages/FundsDashboard.tsx`
- Modify: `src/components/funds/FundCard.tsx`

**Interfaces:**
- Produces: `formatPence(value, symbol)` returning `-£5.00` and `walletBalanceClass(value, defaultClass)` returning red for values below zero.

- [ ] **Step 1: Write failing formatting tests**

```ts
expect(formatPence(-500, '£')).toBe('-£5.00');
expect(formatPence(0, '£')).toBe('£0.00');
expect(walletBalanceClass(-1)).toContain('text-danger');
```

Add focused render assertions for wallet header, child summary, dashboard stat, profile balance, Pet Box wallet, and every wallet selector.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/lib/money.test.ts`

Expected: FAIL because money helpers do not exist.

- [ ] **Step 3: Replace ad-hoc balance formatting**

Use the shared helper for wallet balances and penalty amounts only; do not recolor unrelated fund balances. Ensure negative goal progress is clamped to zero and contribution controls remain disabled while a child is in debt.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/lib/money.test.ts && npm run build`

Expected: PASS.

Commit: `git commit -m "fix: show negative wallet balances consistently"`

---

### Task 7: Integration Verification

**Files:**
- Create: `tests/integration/behaviour-flow.test.ts`
- Modify only files proven necessary by failing tests.

- [ ] **Step 1: Write end-to-end emulator tests**

Exercise owner positive event, parent negative clamp, exact-limit financial penalty, below-limit rejection, event-to-ledger ID link, creator snapshot, subsequent allowance deposit offsetting debt, and child read-only history. After each flow, read all affected documents and assert no unrelated balance changed.

- [ ] **Step 2: Verify RED, fix only integration gaps, and verify GREEN**

Run: `firebase emulators:exec --only firestore 'vitest run tests/integration/behaviour-flow.test.ts'`

Expected first run: FAIL on any orchestration gap. After minimal fixes: PASS.

- [ ] **Step 3: Run the complete quality gate and commit**

Run: `npm test && npm run test:rules && npm run lint && npm run build`

Expected: all tests PASS, lint has no new errors, and production build succeeds.

Commit: `git commit -m "test: verify behaviour v2 flows"`

---

### Task 8: Compatibility and Migration Verification

**Files:**
- Create: `scripts/verify-behaviour-v2-compat.ts`
- Modify: `README.md`

**Interfaces:**
- Produces a read-only compatibility report; it must never mutate Firestore.

- [ ] **Step 1: Write a failing fixture test for the verifier**

Feed V1 events/ledger entries, V2 entries, and a family missing `debtLimitPence`; assert the report counts each format, flags malformed records, and reports the effective default without proposing destructive migration.

- [ ] **Step 2: Implement the read-only verifier**

Reuse normalization helpers, document that no data migration is required, and add README instructions for default debt limits, applied-only deltas, pence storage, and the verification command.

- [ ] **Step 3: Final verification**

Run: `npm test && npm run test:rules && npm run lint && npm run build && git diff --check`

Expected: clean PASS with no whitespace errors. Review `git diff --stat` and `git status --short` to ensure unrelated pre-existing edits were preserved.

- [ ] **Step 4: Commit**

Commit: `git commit -m "docs: document behaviour v2 compatibility"`

---

## TDD Plan

Every phase follows RED → verify expected failure → minimal GREEN → full relevant suite → refactor while green. Domain rules are tested before Firebase orchestration; API contracts before UI; rules before deployment; integration flows before completion. A test that passes before implementation must be corrected so it proves the missing behavior.

## Execution Plan

Execute Tasks 1–8 sequentially because later interfaces depend on earlier tasks. At each task boundary, inspect the diff, run the listed focused test and build/rules gate, and commit only files belonging to that task. After Task 8, invoke `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, and finally `superpowers:finishing-a-development-branch` if all checks pass.
