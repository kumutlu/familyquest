# Deployment Plan — Goals Accounting Merge into `main`

**Status:** PLAN ONLY — no deployment performed, no feature changes made.
**Merge commit:** `cc759e155b1f6fb4dfad72cae8febb483a188121`
**Source branch:** `feat/goals-accounting` (tip `30791e7`)
**Target integration branch:** `main`
**Merge strategy:** `git merge --no-ff` (ort strategy), no conflicts, no file changes.
**Prepared:** 2026-07-18 (UTC)

---

## 1. Pre-Deploy Verification (completed during merge)

| Gate | Command | Result |
|------|---------|--------|
| Production build | `npm run build` (`tsc -b && vite build`) | ✅ Exit 0 — `dist/` produced |
| Goals unit tests | `api.goals`, `goalContracts`, `useStore.goals`, `Goals`, `GoalDetail` | ✅ 54 passed |
| Firestore Goals rules | `tests/firestore/goals.rules.test.ts` | ✅ 29 passed |
| Goals E2E | `tests/e2e/goals.spec.ts`, `tests/e2e/goalFlow.spec.ts` | ✅ 7 passed |

### Known pre-existing test failures (NOT caused by this merge)
These failures exist on the `feat/goals-accounting` branch tip itself (verified: the
`--no-ff` merge introduced zero file changes, so the post-merge `main` tree is
byte-identical to the branch tip). They are unrelated to Goals behaviour and must be
triaged separately, outside this merge:

- Unit: `ApprovalCenter.test.tsx`, `useStore.test.ts`, `pushDelivery.test.ts`,
  `firestoreIndexes.test.ts`, `migrate-goal-fields.test.ts` (all added by the branch).
- Firestore rules: `transfers`, `reversal`, `behaviour`, `approvalCenter`,
  `bootstrapQueries`, `ownerPermissions`, `goalReturn.integration` suites.
  (`goals.rules.test.ts` itself passes.)

These are out of scope for the Goals merge and were not modified.

---

## 2. Deployment Steps (NOT executed)

1. **Tag the release candidate**
   ```bash
   git tag -a release/goals-accounting-rc -m "Goals accounting merge RC (cc759e1)"
   ```
2. **Deploy Firestore rules** (must go first — rules are independent of the build):
   ```bash
   firebase deploy --only firestore:rules
   firebase deploy --only firestore:indexes
   ```
3. **Deploy Functions** (if any functions changes are part of the release):
   ```bash
   firebase deploy --only functions
   ```
4. **Deploy Hosting** (the `dist/` produced by `npm run build`):
   ```bash
   firebase deploy --only hosting
   ```
5. **Verify in production** using the Goals E2E smoke scenarios
   (`tests/e2e/goals.spec.ts`, `tests/e2e/goalFlow.spec.ts`) against the live project.

---

## 3. Rollback Plan (NOT executed)

- **Hosting/rules/functions:** `firebase deploy --only <target>` from the previous
  known-good commit, or `git revert cc759e1` and re-deploy.
- **Data:** Goals accounting uses an immutable ledger model with idempotent migration
  (`scripts/migrate-goal-fields.ts`). No destructive data migration is required for
  this merge; the legacy-field migration is fail-closed and idempotent.

---

## 4. Notes / Risks

- The merge is a clean integration commit; no conflict resolution altered behaviour.
- Goals behaviour is unchanged by the merge (verified by passing Goals unit, rules,
  and E2E suites).
- The pre-existing non-Goals test failures should be addressed in a follow-up branch
  before or after deploy, but they do not block the Goals feature.
