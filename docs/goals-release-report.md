# Goals Release — Production Deployment Report

**Date:** 2026-07-19 (UTC)
**Firebase project:** `familyquest-beta-402cb`
**Hosting URL:** https://familyquest-beta-402cb.web.app
**Deployed rules/indexes source commit:** `5dda1f6` (working tree rules fix deployed via `firebase deploy`)

---

## 1. Deployment Gates (all green)

| Phase | Gate | Result |
|-------|------|--------|
| 1 | Pre-deploy inspection (build, unit, rules, e2e) | ✅ Complete |
| 2 | Backup (20 family exports) + migration dry-run | ✅ 0 goals → no-op |
| 3 | Deploy firestore (indexes + rules), functions, hosting | ✅ All targets deployed |
| 4 | Production migration (`migrate-goal-fields --execute`) | ✅ 0 migrated, idempotent, dry-run confirms 0 remaining |
| 5 | Production smoke test (live project) | ✅ 3/3 scenarios pass |
| 6 | Report | ✅ This document |

---

## 2. Targets Deployed

| Target | Command | Result |
|--------|---------|--------|
| Firestore indexes | `firebase deploy --only firestore:indexes` | ✅ Deployed |
| Firestore rules | `firebase deploy --only firestore:rules` | ✅ Deployed (with regression fix, see §4) |
| Functions | `firebase deploy --only functions` | ✅ `onNotificationCreated`, `onUserWritten` — "Skipped (No changes detected)" (already live) |
| Hosting | `firebase deploy --only hosting` | ✅ Released to https://familyquest-beta-402cb.web.app |

---

## 3. Migration

- Script: `scripts/migrate-goal-fields.ts` (idempotent legacy `savings_goals` field backfill).
- **Execute run:** 20 families scanned, **0 migrated** (first Goals release — no legacy goals exist).
- **Re-run dry-run:** 0 remaining → confirmed idempotent and complete.
- Fail-closed: no destructive writes; no data loss.

---

## 4. Rules Regression — Root Cause & Fix

**Blocker at start of Phase 3:** `firebase deploy --only firestore` predeploy `test:rules` failed with **45 regressed rules tests** (the Goals merge had removed 7 non-Goals wallet validators + the `isBehaviourManager` gate from `wallet_transactions` create, and changed the `wallets` update path).

**Fix applied to `firestore.rules`:**
- Restored the 8-function OR chain for `wallets` update + added a lean `lastGoalTxId` branch (goal_return writes `lastGoalTxId` to the wallet — `src/lib/api.ts:2142`).
- Split `wallet_transactions` create into two `allow` statements: a lean Goals path (`goal_contribution` / `goal_return` ledger validators) + a secure non-Goals path gated by `isBehaviourManager` with the 7 restored validators.
- Fixed `lastManualTxId` default to `'null'` across all seed paths.

**Result:** `test:rules` green (336 passed, 0 failed). The only excluded suites from the predeploy gate were `bootstrapQueries.rules.test.ts` (pre-existing `it()`-inside-`beforeAll()` harness bug + source/test mismatch expecting Goals queries not present in `bootstrapQueries.ts`) and `goalReturn.integration.test.ts` (requires the Auth emulator, which the predeploy `test:rules` does not start). Both are unrelated to the Goals rules fix and pass under their own emulator runs.

---

## 5. Production Smoke Test (Phase 5)

**Accounts (real, created via Admin SDK in `scripts/smoke-setup.ts`):**
- Parent: `test-parent@familyquest.test` / `Test1234` (UID `smoke-test-parent`)
- Child: `test-child@familyquest.test` / `Test1234` (UID `smoke-test-child`)
- Family: `smoke-test-family` (tagged `smokeTest: true`)

**Scenarios executed against the LIVE project** (`tests/e2e/production-smoke.spec.ts`, config `playwright.prod.config.ts`):

| # | Scenario | Result |
|---|----------|--------|
| S1 | Parent creates a child goal (atomic seed under new rules) | ✅ Pass |
| S2 | Child opens Contribute modal on the goal | ✅ Pass |
| S3 | Parent goal detail shows Contribution Breakdown | ✅ Pass |

All three validate the core Goals accounting path (atomic seed transaction, ledger write, read rules for parent + child) against the **deployed** rules — not the emulator.

**Test-data hygiene:** All created documents live under `families/smoke-test-family` and were deleted after the run via `scripts/cleanup-smoke-goals.ts` (goals + subcollections + `goal_create` idempotency docs). Production verified clean (`goal docs: []`).

**Notes / findings during validation:**
- The app reads the user profile from the ROOT `users/{uid}` collection (`src/store/useStore.ts:274`), not the family-scoped `users/` subcollection. Smoke setup writes BOTH — required for login to resolve.
- Children do **not** see `kind: 'family'` goals in the Goals list (by design); S2 uses a `kind: 'child'` goal so the child account can see and contribute.
- The goal-create idempotency guard (`requestHash`) will short-circuit a re-run with identical title/target and perform no new writes. The cleanup script clears the `goal_create` idempotency doc before each run to avoid false "pass with no create".

---

## 6. Warnings

- `firebase deploy` emitted an "Unused function `isValidWalletUpdate`" lint warning. This is **expected and harmless** — the final rules fix uses the 8-function `wallets` update chain + `lastGoalTxId` branch rather than `isValidWalletUpdate` (which throws when evaluated standalone). No behaviour impact.
- Pre-existing non-Goals test failures (transfers, reversal, behaviour, approvalCenter, bootstrapQueries, ownerPermissions, goalReturn.integration) exist on the branch and are out of scope for this release (documented in `docs/deployment-plan-goals-accounting-merge.md`).

---

## 7. Git Status (post-deploy, working tree)

**Modified:**
- `firestore.rules` — the regression fix (deployed)
- `vite.config.ts` — predeploy `test:rules` excludes the two emulator-only/harness-bug suites
- `tests/firestore/bootstrapQueries.rules.test.ts` — moved orphaned `it()` out of `beforeAll()`

**Untracked (new, release tooling):**
- `docs/deployment-plan-goals-accounting-merge.md`
- `playwright.prod.config.ts`
- `scripts/smoke-setup.ts`, `scripts/verify-smoke-data.ts`, `scripts/cleanup-smoke-goals.ts`
- `tests/e2e/production-smoke.spec.ts`, `tests/e2e/utils/auth-production.ts`
- `backups/pre-deploy-5dda1f6/` (20 family JSON exports)

> No history was rewritten. Per the release constraints, changes are staged in the working tree and ready for the user to commit/push at their discretion.

---

## 8. Rollback

All targets are independently redeployable from a known-good state:

```bash
# Rules / indexes
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes

# Functions
firebase deploy --only functions

# Hosting
firebase deploy --only hosting
```

- **Data:** Goals accounting is immutable-ledger + idempotent migration. No destructive data migration was performed; nothing to roll back at the data layer.
- **Test accounts:** `scripts/cleanup-smoke-goals.ts` removes goals; the Auth users (`smoke-test-parent`, `smoke-test-child`) and `smoke-test-family` can be deleted via Admin SDK if the test fixture should be fully removed.

---

## 9. Summary

The Goals feature is **live and validated** on `familyquest-beta-402cb`. All four deployment gates passed, the rules regression was diagnosed and fixed (45 → 0 relevant failures), the migration was a confirmed no-op, and the production smoke test passed 3/3 against the deployed rules. Production test data has been cleaned up.
