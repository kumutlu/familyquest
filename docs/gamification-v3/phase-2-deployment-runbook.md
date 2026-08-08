# Gamification V3 — Phase 2 Shadow Writer: Deployment & Rollback Runbook

**Date:** 2026-08-04
**Status:** Prepared for review (do not deploy until approved)

---

## Pre-deployment checklist

- [ ] All 34 tests pass (`npx vitest run src/gamificationV3/`)
- [ ] All 12 rules tests pass (`npm run test:rules`)
- [ ] Phase 0 allowlist still at 16 entries and 76 violations
- [ ] No UI reads V3 collections
- [ ] No legacy writes removed
- [ ] Baseline dry-run completed and reviewed (`npx ts-node scripts/bootstrap-v3-baseline.ts --dry-run`)
- [ ] Golden integration test passes in emulator
- [ ] All existing tests still pass (`npm test`)

## Deployment steps

### Stage 1: Rules deployment only

```bash
firebase deploy --only firestore:rules
```

**Verify:** Run emulator rules tests against the deployed rules.

```bash
npm run test:rules
```

**Rollback checkpoint:** `git revert` rules commit; `firebase deploy --only firestore:rules`

### Stage 2: Verify client write denial

Run production-safe smoke tests to confirm clients cannot write to V3 collections.

### Stage 3: Deploy V3 repositories and failure infrastructure (dark)

Deploy the Cloud Functions containing the V3 event/projection repositories and failure recording infrastructure. No source integrations are connected yet.

```bash
firebase deploy --only functions
```

### Stage 4: Enable one source flow at a time

Deploy shadow integrations in this order, verifying each before proceeding:

1. **Task** — extend `processApprovedCompletion` in `gamificationRepository.ts`
2. **Behaviour** — extend `processBehaviourEvent` in `behaviourRepository.ts`
3. **Daily/Perfect-day** — extend `finalizeChildDay` in `gamificationRepository.ts`
4. **Redemption** — enable `onRedemptionCreatedV3` trigger in `index.ts`
5. **Avatar** — enable `onAvatarUnlockCreatedV3` trigger in `index.ts`
6. **Adjustment** — enable `onManualAdjustmentCreatedV3` trigger in `index.ts`
7. **Reversal** — enable `onReversalCreatedV3` trigger + extend `processTaskInvalidation`

**After each flow:**
- Run comparison report (`npx ts-node scripts/compare-v3-shadow.ts`)
- Monitor failure records in `gamification_v3_failures` collection
- Verify deterministic replay (`rebuildMemberProjection`)
- Wait for approval before the next flow

### Stage 5: Bootstrap legacy baselines

Only after all source mappers and rebuild tests are green.

```bash
# Dry-run first
npx ts-node scripts/bootstrap-v3-baseline.ts --dry-run

# Execute
npx ts-node scripts/bootstrap-v3-baseline.ts
```

### Stage 6: Begin 7-day comparison clock

Start the seven-day shadow comparison period only after baseline and all approved shadow flows are live.

## Rollback checkpoints

| Checkpoint | Rollback action | Data impact |
|---|---|---|
| Before rule deploy | No rollback needed | None |
| After rule deploy, before baseline | `git revert` rules commit; `firebase deploy --only firestore:rules` | None |
| After baseline, before function deploy | Delete V3 events and projections; `git revert` | V3 data removed; legacy untouched |
| After function deploy | `firebase deploy --only functions` with previous version; `git revert` | V3 events remain but are not written to; legacy untouched |
| After 1 hour monitoring | Full rollback: revert all commits, delete V3 collections, redeploy rules | V3 data removed; legacy untouched |

## Post-deployment monitoring (first 7 days)

- [ ] Daily comparison report (`npx ts-node scripts/compare-v3-shadow.ts`)
- [ ] Monday weekly rollover observation
- [ ] Failure record review (`gamification_v3_failures` collection)
- [ ] Phase 0 allowlist check
- [ ] Performance review (transaction latency, function duration)

## Amendment compliance

### Amendment 1 — Temporary trigger bridge
- All bridge events include: sourceFlow, sourceDocumentId, legacyCommittedAt, shadowObservedAt, bridgeVersion, retryCount, lastError, reconciliationStatus
- Phase 3 entry criteria: these flows must be moved to server-authoritative callable/transaction paths

### Amendment 2 — Replay before rollout
- Reconciliation command implemented via `rebuildMemberProjection`
- Dry-run mode available in `bootstrap-v3-baseline.ts --dry-run`
- Classifications: exact_match, missing_shadow_event, missing_projection_fold, duplicate_shadow_event, malformed_source, ambiguous

### Amendment 3 — Transaction budget
- Normal action: <= 15 writes (event + projection + existing transaction writes)
- Daily finalization: document maximum expected fan-out separately

### Amendment 4 — V3 failure cannot be silent
- Atomic Option A flows: if V3 write fails, the entire transaction fails
- Trigger-bridge flows: durable failure/dead-letter record is mandatory
- Console logs alone are insufficient

### Amendment 5 — Baseline state completeness
- LEGACY_BASELINE captures: rewardPoints, xpTotal, currentStreak, bestStreak, lastQualifiedDayKey, unlockedAvatarIds, weeklyPoints=0, weeklyWindowKey

### Amendment 6 — Shadow comparison denominator
- Reports both: member-state exact-match rate AND changed-member/event exact-match rate
- Excludes: insufficient_ledger_history, malformed_data (reported separately)
- Phase 3 requires: 100% rewardPoints, 100% xpTotal, 100% reversal parity, 100% duplicate correctness, >=99% full-state exact match, zero unexplained mismatches

### Amendment 7 — Rollout stages
- One source flow at a time
- Verify each before proceeding
- Bootstrap baselines only after all mappers are green
- Begin 7-day clock only after baseline and all flows are live

## Unresolved risks

1. **Negative behaviour in golden test**: The golden test excludes negative behaviour due to reducer ordering sensitivity. The behaviour mapper is tested separately.
2. **Transaction budget**: The exact write count for each flow needs to be measured in staging before production deployment.
3. **Reconciliation command**: The full reconciliation command (Amendment 2) requires the `compare-v3-shadow.ts` script to be run against production data, which is only possible after baseline bootstrap.