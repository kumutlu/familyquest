# Cutover Readiness Audit — Gamification V4

**Scope:** whole repository. **Stage 7 was NOT started, NOT executed, nothing deployed, no cutover performed.**
Read-only analysis + one test-only safe fix (commit `3b0a017`).

**Verdict: NOT READY for Stage 7.** Three blocking gaps (B1–B3) and one hard blocker
on rollback (R1). Details below.

---

## 1. Architecture report

| Layer | Modules | Boundary status |
|---|---|---|
| Pure domain V4 | `src/domain/gamification/v4/*` (types, ids, validators, ordering, level, streak, achievements, reversal, reducer, rebuild, storage, replay/*) | ✅ pure — no `firebase`/`firebase-admin` import (now pinned by `tools/architecture/v4-cutover-boundary.test.ts`) |
| Server V4 I/O | `functions/src/gamification/v4/{repository,rebuildFunction,failures}.ts` | ✅ every exported async entry point calls `assertEmulatorOnly()` (8 call sites); ✅ not referenced by `functions/src/index.ts` |
| Migration (Stage 5) | `scripts/migrate/{write-v4-ledger,migration-marker}.ts` | ✅ CLI-only (`invokedDirectly` guard), no import side effects |
| Verification (Stage 6) | `scripts/verify/pre-cutover.ts` | ✅ read-only gate |
| Legacy authoritative V1/V2 | `functions/src/gamificationRepository.ts`, `functions/src/behaviourRepository.ts`, `src/lib/api.ts`, `src/lib/reversalApi.ts` | ⚠️ still the only production writers |
| Shadow V3 | `functions/src/gamificationV3/*` | ⚠️ still live, non-authoritative |

Single state builder confirmed: `reduceGamificationEventsV4()` is the sole fold;
`rebuildStateFromLedger()` delegates to it, `rebuildAllMembers()` partitions per member.
No second reducer exists anywhere (`scripts/replay/*`, `scripts/verify/*`, `rebuildFunction.ts`
all import the same helper).

## 2. Stage 4 artifact usage

| Artifact | Consumed by | Verdict |
|---|---|---|
| `repository.ts` (`writeEventIdempotent`, `readLedger`, `writeState`, `readState`, `assertEmulatorOnly`) | Stage 5 `write-v4-ledger.ts`, `migration-marker.ts`; Stage 6 `pre-cutover.ts`; tests | ✅ used |
| `rebuildFunction.ts` (`rebuildProjection`) | **only its own tests** | ⚠️ **B1 — unwired.** Intended Stage 7/9 operational rebuild entry point; no callable/schedule export |
| `failures.ts` (`recordFailure`, `readFailures`, `FAILURES_V4_COLLECTION_ID`) | **only its own tests** | ⚠️ **B2 — unwired.** No writer records failures; `gamification_failures` has **no Firestore rule** (default-deny; correct for clients, but no read path for operators) |
| `rejectCrossFamily()` | exported, no caller outside tests | dead-ish (defensive) |

## 3. Stage 5 artifact consumption

| Artifact | Consumed by | Verdict |
|---|---|---|
| `write-v4-ledger.ts` (`writeMigrationLedger`, `assertApprovedGate1`, `loadApprovedReport`) | `migration-marker.ts`, `pre-cutover.ts`, tests | ✅ |
| `migration-marker.ts` (`MigrationMarkerV4`, `migrationMarkerDocPath`, `rerunIsNoOp`, wallet-hash manifest) | `pre-cutover.ts` (`readMigrationMarker`), tests | ✅ |
| `03-production-replay-report.json` (Gate 1 artifact) | `assertApprovedGate1` | ✅ |

## 4. Stage 6 verification referenced by Stage 7

`verifyPreCutover()` is referenced **only** by `scripts/verify/pre-cutover.test.ts` and
`docs/gamification-v4/06-verification-report.md`. There is no Stage 7 code, so no consumer
exists — expected, but it means **the gate is advisory, not enforced**: nothing mechanically
blocks a writer cutover on a failing `PreCutoverReport`. → **B3**.

## 5. Dead code paths still writing legacy rewardPoints / XP

Live (not dead) but legacy: see §6. Genuinely dead/stale:

- `scripts/backfill-gamification-xp.ts` — pre-cutover XP reconstruction, superseded by the V4 `MIGRATION_BASELINE` baseline; still exposed via `npm run gamification:backfill` (writes prod).
- `scripts/migrate-legacy-xp.ts`, `scripts/legacy-xp-baseline.ts`, `scripts/repair-gamification-migration.ts`, `scripts/reconcile-xp-ledger.cjs`, `scripts/p0-rebuild-projections.cjs`, `scripts/p0-recover-unprocessed-approvals.cjs` — V1/V3-era repair tools that write authoritative balances; none is gated on the V4 migration marker.
- `scripts/bootstrap-v3-baseline.ts`, `scripts/compare-v3-shadow.ts` — Stage 5/6 of the *V3* runbook, superseded by V4 Stage 5/6.
- ~40 one-shot `scripts/*.cjs` patch/investigate/fix scripts (`patch-*`, `fix-e2e*`, `investigate-*`, `dump-repair-inputs*`, `p0-*`), plus root `checkAli.tmp.*`, `patch.cjs`, `test-prod-approval.cjs`, `firestore.rules.bak/.bak2/.patch`, `package-json.patch` — no callers, admin-credentialled.

## 6. Remaining legacy authoritative writers (7)

| # | Writer | Location | Fields |
|---|---|---|---|
| 1 | task approval | `functions/src/gamificationRepository.ts` `processApprovedCompletion` | `users.rewardPoints`, `users.lifetimeXP`, `gamification_summaries.xpTotal` |
| 2 | task invalidation/reversal | `gamificationRepository.ts` (`rewardPoints: nextPoints`) | `users.rewardPoints` |
| 3 | day finalisation | `gamificationRepository.ts` `finalizeChildDay` | `summaries.xpTotal`, `users.lifetimeXP` |
| 4 | behaviour events | `functions/src/behaviourRepository.ts` | `rewardPoints`, `lifetimeXP`, `xpTotal` |
| 5 | reward redemption (**client**) | `src/lib/api.ts:1078` | `users.rewardPoints` |
| 6 | challenge claim + manual adjust (**client**) | `src/lib/api.ts:984,1130` | `rewardPoints`, `lifetimeXP` |
| 7 | avatar unlock (**client**) + goal reversal | `src/lib/api.ts:3132`, `src/lib/reversalApi.ts:116` | `users.rewardPoints` |

Writers 5–7 are **client-side, browser-trusted** balance mutations — the highest-risk
cutover items (see Risk R2).

## 7. V3 / V4 inconsistencies

| # | Inconsistency |
|---|---|
| I1 | V3 keeps `weeklyPoints` as a business field; V4 `BUSINESS_FIELD_NAMES_V4` drops it. Weekly leaderboard data has no V4 home. |
| I2 | V3 event ids are human-readable (`task-approved:fam:mem:key`); V4 uses `fam::mem::TYPE::sourceId`. No id translation map exists → V3 ledger cannot be diffed against V4 by id. |
| I3 | V3 collections `gamification_events_v3` / `gamification_state_v3`; V4 uses the **unsuffixed** `gamification_events` / `gamification_state`, which the legacy V1 system also references in rules comments. Collision risk on rollback. |
| I4 | Level curve: V4 fixes `XP_PER_LEVEL_V4 = 1000` as a constant; `gamificationRepository.ts` calls `levelForXp(nextXp, 1000)` with 1000 as a *parameter*. Two formulas, coincidentally equal today. |
| I5 | V3 incremental merge accumulates `rewardPoints` via a computed key (`const RP = 'rewardPoints'`) **explicitly to evade the freeze guard** (`gamificationV3/integration.ts:124-126`). |
| I6 | V3 shadow merge does not recompute level-derived fields (documented defect in `integration.test.ts:556`); V4 always recomputes. Shadow comparison can report false diffs. |

## 8. Rebuild-function equivalence

✅ Proven by tests: `rebuild.test.ts` asserts `businessFields(rebuildStateFromLedger(...)) === businessFields(reduceGamificationEventsV4(...))` including `JSON.stringify` byte equality, order independence, and `updatedAt` independence. `repository.test.ts`, `repository.emulator.test.ts`, `rebuildFunction.test.ts` and `write-v4-ledger.test.ts` each re-assert stored-vs-rebuilt equality. `rebuildFunction` idempotency verified on the real emulator (single doc per member, no root-level doc, no wallet collection).
⚠️ Not proven: equivalence between the **V3 projection** and the **V4 rebuild** for the same family (no cross-version equivalence test exists).

## 9. Migration idempotency

✅ `write-v4-ledger` uses `writeEventIdempotent` keyed on the deterministic `eventIdFor(...)`; re-run writes no new events.
✅ `migration-marker.rerunIsNoOp` + wallet-hash BEFORE == AFTER proof (Gate 2 tests #14/#15).
⚠️ Idempotency is proven for `write-v4-ledger` and the marker only. `scripts/backfill-gamification-xp.ts` and `repair-gamification-migration.ts` have **no idempotency proof** and still write authoritative XP.

## 10. Feature-flag dependencies

❌ **B3 — there are no feature flags at all.** Repository-wide search for
`V4_CUTOVER|v4Enabled|featureFlag|FEATURE_FLAG|gamificationV4` returns zero hits.
The plan's GATE 3 ("all 7 legacy writers gated") is unimplementable as designed: there is
no per-writer kill switch, no per-family rollout flag, and no runtime read of
`families/{id}.gamificationMigration.status` in any V4 module. The only kill switch is
`assertEmulatorOnly()`, which is binary and would have to be *removed* to cut over —
i.e. cutover currently means deleting the safety mechanism.

## 11. Rollback report

| Stage | Rollback path | Status |
|---|---|---|
| 3 (replay) | delete generated artifacts | ✅ no prod impact |
| 4 (repository) | nothing deployed | ✅ |
| 5 (ledger + marker) | delete `gamification_events`/`gamification_state` + marker, restore wallet snapshot (`scripts/wallet-snapshot.cjs`, `backup-gamification-collections.cjs`) | ⚠️ scripts exist but **no tested delete/rollback script**; deletion is manual |
| 6 (verify) | none needed | ✅ |
| 7 (writer cutover) | **R1 — none.** No flag to flip back (§10), no dual-write, no documented procedure for reverting client bundles (writers 5–7 live in the deployed SPA — rollback requires a hosting re-deploy, not a config change) | ❌ **BLOCKER** |

## 12. Firestore rules after cutover

- ✅ `families/{id}/gamification_events/{eventId}` — member read, client write denied.
- ✅ `families/{id}/gamification_state/{memberId}` — member read, client write denied.
- ⚠️ `gamification_failures` — **no rule** → default deny (safe for clients, but no operator/read path; Stage 4 artifact unusable in prod).
- ⚠️ `gamification_events_v3` / `gamification_state_v3` rules remain; no removal plan.
- ❌ `users.rewardPoints` / `users.lifetimeXP` remain **client-writable** (writers 5–7 depend on it). After cutover these must become server-only, and that rules change is a production-behaviour change — reported only, not made.
- Stale artefacts in tree: `firestore.rules.bak`, `.bak2`, `.patch`, `deployed-rules.rules` — risk of deploying the wrong file.

## 13. Cloud Functions after cutover

Deployed (`functions/src/index.ts`): `onTaskCompletionWritten`, `onGamificationReversalCreated`,
`onBehaviourEventCreated`, `onFamilyCreatedInitializeGamification`, `finalizeGamificationDays`,
`onNotificationCreated`, `onUserWritten`, plus child/family/account callables.
**Zero V4 functions are deployed.** Post-cutover the first five must be re-pointed at the V4
repository; `rebuildProjection` must be exported as an admin callable. Neither exists.

## 14. Emulator integrations

✅ `repository.emulator.test.ts`, `rebuildFunction.test.ts` (integration block),
`write-v4-ledger.test.ts`, `migration-marker.test.ts`, `pre-cutover.test.ts` all run against
`firebase emulators`, and `assertEmulatorOnly` fails closed when `FIRESTORE_EMULATOR_HOST` is unset.
⚠️ None of these V4 emulator suites is wired into `npm run test` or `.github/workflows/ci.yml`
— they only run if invoked manually. **CI does not execute a single V4 emulator test.**

## 15. Hidden production write paths

| Path | Assessment |
|---|---|
| Client SDK writes to `users.rewardPoints` (`api.ts` ×4, `reversalApi.ts` ×1) | **Real, live, browser-trusted** — the biggest hidden write surface |
| `scripts/*.cjs` with admin credentials + committed service-account keys (`firebase-key.json`, `familyquest-beta-*-adminsdk-*.json`, `.env.production`) | **Critical** — credentials in the working tree; any script can write prod |
| V4 modules | none — emulator-gated and unexported (now guarded by test) |
| `npm run gamification:backfill`, `data:reset` | write prod, guarded only by `--execute` |

---

## Cutover dependency graph

```
docs/gamification-v4/03-production-replay-report.json  (GATE 1, owner-approved)
        │
        ├─> scripts/replay/{run-dry-run,verify,reconcile,production-report}.ts
        │        └─> src/domain/gamification/v4/replay/{sources,classify,report}
        v
scripts/migrate/write-v4-ledger.ts ──uses──> functions/src/gamification/v4/repository.ts
        │                                          └─> src/domain/gamification/v4/{ids,validators,storage}
        │        └─> src/domain/gamification/v4/rebuild.ts ──> reducer (SOLE fold)
        v
scripts/migrate/migration-marker.ts   (GATE 2: wallet hash before==after, rerun no-op)
        v
scripts/verify/pre-cutover.ts  (Stage 6, six checks, fail-closed)
        v
      GATE 3  ── ✗ BLOCKED: no feature flags, no rollback, gate not enforced in code
        v
STAGE 7 (writer cutover)  — NOT STARTED
   would require: rebuildFunction.ts export + failures.ts wiring + rules change
                 (users.rewardPoints -> server-only) + client bundle redeploy
```

---

## Bug list

| id | severity | bug | production behaviour? |
|---|---|---|---|
| B1 | high | `rebuildProjection` (Stage 4) unwired — no operational rebuild path | yes → report only |
| B2 | high | `failures.ts` unwired; `gamification_failures` has no Firestore rule | yes → report only |
| B3 | **blocker** | No feature flags anywhere; GATE 3 unimplementable; `verifyPreCutover` not enforced by code | yes → report only |
| B4 | high | V3 shadow merge evades the freeze guard via computed key `const RP = 'rewardPoints'` | tooling, but fixing changes guard semantics → report only |
| B5 | medium | Freeze guard misses `increment()`, computed-key and spread writes (`FORBIDDEN_WRITER_PATTERNS` is 2 literal regexes) | tooling → report only (CI-destabilising) |
| B6 | medium | Two level formulas (I4) — `XP_PER_LEVEL_V4` const vs `levelForXp(xp, 1000)` param | yes → report only |
| B7 | medium | V3 merge does not recompute level-derived fields (known defect) | yes → report only |
| B8 | medium | No V4 emulator test runs in CI | test-infra; needs emulator in CI → report |
| B9 | **critical** | Service-account keys + `.env.production` committed to the repo | security → report only |
| B10 | medium | Four rules files in tree (`firestore.rules`, `.bak`, `.bak2`, `deployed-rules.rules`) — deploy-wrong-file risk | yes → report only |
| B11 | low | `weeklyPoints` has no V4 business field (I1) | yes → report only |
| B12 | low | `rejectCrossFamily()` exported but never called by a writer | no, but a fix would add a runtime check → report only |

**Every finding either changes production behaviour or destabilises CI, so per the
instructions no production fix was applied.** The single SAFE fix (test-only, additive,
green) was committed separately.

## Fixes applied

| commit | change | safety |
|---|---|---|
| `3b0a017` | `tools/architecture/v4-cutover-boundary.test.ts` — 17 static assertions: no `gamification/v4` reference in `functions/src/index.ts`; every exported async V4 function calls `assertEmulatorOnly`; V4 domain imports no firebase SDK | test-only, no runtime code touched, `vitest run --dir tools` 63/63 green |

## Improvement list

1. Introduce `gamificationV4Flags.ts` with a per-writer, per-family flag read from `families/{id}.gamificationMigration` (prerequisite for GATE 3).
2. Make `verifyPreCutover()` a hard runtime precondition of every V4 writer, not a report.
3. Move writers 5–7 out of `src/lib/api.ts` into callables **before** cutover, so rollback is a server deploy, not a bundle deploy.
4. Export `rebuildProjection` as an admin-only callable; add `gamification_failures` rules (server-write, parent-read).
5. Replace `assertEmulatorOnly` with a two-mode guard (`emulator | flagged-production`) so cutover does not require deleting the safety net.
6. Strengthen the freeze guard: AST-based detection of computed-key and `increment()` writes.
7. Add a tested `rollback-v4.ts` (delete ledger/state/marker, restore wallet snapshot) with emulator proof.
8. Unify the level curve on `XP_PER_LEVEL_V4`.
9. Delete the ~50 dead one-shot scripts; rotate and remove committed credentials; delete stale rules files.
10. Add a V3↔V4 event-id translation table to enable cross-version diffing.

## Missing tests

- V3 projection vs V4 rebuild equivalence for the same family fixture.
- Idempotency proof for `backfill-gamification-xp.ts` and `repair-gamification-migration.ts`.
- Firestore rules test for `gamification_failures` (deny client read/write).
- Rules test proving `users.rewardPoints` is server-only (post-cutover target state).
- Rollback test: ledger + state + marker deletion restores the pre-migration wallet hash.
- CI job executing the V4 emulator suites (`repository.emulator`, `write-v4-ledger`, `migration-marker`, `pre-cutover`).
- Cross-family isolation test invoking `rejectCrossFamily` from a writer.
- `weeklyPoints` parity test (or an explicit ADR that V4 drops it).

## Missing documentation

- Stage 7 runbook (there is a Stage 4–6 runbook for **V3** only: `docs/gamification-v3/phase-2-deployment-runbook.md`).
- Rollback procedure for Stages 5 and 7.
- Feature-flag design + GATE 3 exit criteria as executable checks.
- ADR for dropping `weeklyPoints` and for unsuffixed V4 collection ids (collision with legacy `gamification_events`).
- Operational guide for `rebuildProjection` and `gamification_failures` triage.
- Inventory of the 7 legacy writers with their per-writer cutover order and rollback owner.
