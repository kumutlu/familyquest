# Stage 7 Infrastructure — Feature Flags, Cutover Config, Rollback & Gate

**Status:** Infrastructure ONLY. **No Stage 7 cutover was performed, no legacy writer
was modified, no V4 writer was activated, nothing was deployed, and no production
write occurred.** This document describes the *missing infrastructure* that the
Stage 7 readiness audit (`07-cutover-readiness-audit.md`) identified as blocking
gaps B3 and R1, now implemented behind the emulator-only guard so it can never
target production.

It closes:

- **B3 (blocker)** — "No feature flags anywhere; GATE 3 unimplementable;
  `verifyPreCutover` not enforced by code." → feature flag framework +
  mandatory gate.
- **R1 (blocker)** — "No flag to flip back … rollback requires a hosting
  re-deploy, not a config change." → instant, config-only rollback.

It deliberately does **NOT** close B1/B2 (wiring `rebuildProjection` /
`failures.ts` into deployed functions) or any production-behaviour change,
because those require a deploy and are out of scope for this P0.

---

## 1. New feature flag design

### 1.1 Why

The audit found that the only kill switch was `assertEmulatorOnly()`, which is
binary: cutover currently would mean *deleting* the safety mechanism. GATE 3
("all 7 legacy writers gated") was therefore unimplementable. We need a
per-writer, per-family, runtime-readable flag that defaults to **legacy** and
can be flipped without touching code or redeploying.

### 1.2 Shape (`src/domain/gamification/v4/featureFlags.ts`, pure)

```ts
type GamificationWriter =
  | 'task_approval'        // functions/src/gamificationRepository.ts processApprovedCompletion
  | 'task_invalidation'   // gamificationRepository.ts rewardPoints reversal
  | 'day_finalization'    // gamificationRepository.ts finalizeChildDay
  | 'behaviour'           // functions/src/behaviourRepository.ts
  | 'reward_redemption'   // src/lib/api.ts (client, browser-trusted)
  | 'challenge_claim'     // challenge claim + manual adjust (src/lib/api.ts)
  | 'avatar_unlock'       // avatar unlock + goal reversal (src/lib/api.ts, reversalApi.ts)

interface FeatureFlagSet {
  writers: Record<GamificationWriter, boolean>          // default route for all families
  familyOverrides: Record<string, Partial<Record<GamificationWriter, boolean>>>
}
```

- `resolveWriterRoute(flags, writer, familyId?)` → `'legacy' | 'v4'`.
- `defaultFeatureFlags()` → **every writer `false`** (fail closed).
- `withWriterEnabled / withWriterDisabled` → flip one writer globally or for a
  single family (canary / per-family rollback).
- `withAllV4 / withAllLegacy` → bulk transitions.
- `allLegacy / allV4` → predicates used by the gate and tests.

The module is **pure** (no `firebase` import) so it is safe to import from the
client bundle and Cloud Functions, and is pinned by the architecture boundary
test.

### 1.3 Where it lives at runtime

The live `FeatureFlagSet` is persisted per family in the **runtime cutover
configuration layer** (§2), not in `gamificationMigration.status`. This keeps
the migration marker (Gate 2 proof) immutable while the cutover flag is mutable.

---

## 2. Runtime cutover configuration layer

`functions/src/gamification/v4/cutoverConfig.ts` (emulator-gated).

- Document: `families/{familyId}/gamification_cutover_config/config`.
- Shape:

```ts
interface CutoverConfig {
  schemaVersion: number
  familyId: string
  status: 'not_started' | 'active' | 'rolled_back'
  flags: FeatureFlagSet
  activatedAt / activatedBy: string | null
  rolledBackAt / rolledBackBy / rollbackReason: string | null
}
```

- `readCutoverConfig(db, familyId)` → returns the **fail-closed default** when
  the doc is absent (an unconfigured family is never V4).
- `activateStage7(db, familyId, opts?)` → `status: 'active'`, arms every writer
  (or a supplied flag set), persists.
- `setWriterFlag(db, familyId, writer, enabled)` → flips a **single** writer at
  runtime (the GATE 3 per-writer kill switch / canary control).
- Every Firestore-touching function calls `assertEmulatorOnly`, so this layer
  can never target production and never "deletes the safety net".

---

## 3. Mandatory Stage 7 gate (was advisory)

`functions/src/gamification/v4/stage7Gate.ts` (emulator-gated).

`verifyPreCutover()` (Stage 6) was previously advisory — nothing blocked a
writer cutover on a failing report. `assertStage7Allowed(deps)` makes it
**mandatory**:

1. **Gate 1** — `report.gate === 'GATE_1_REACHED'` (owner-approved replay).
2. **Gate 2** — migration marker present **and** `walletHashOk` (BEFORE == AFTER).
3. **Stage 6** — `verifyPreCutover(familyId, …).passed` is **true**.

Any failure throws `Stage7BlockedError` carrying the full `Stage7Readiness`
verdict (which gate failed + why). The pure decision core is
`evaluateStage7Readiness` (`src/domain/gamification/v4/stage7Readiness.ts`),
reused so there is no second gate arithmetic.

`assertWriterCutoverAllowed(deps, writer)` adds GATE 3 granularity: a specific
legacy writer may only be re-pointed at V4 when (a) the family-wide gate is
satisfied AND (b) the runtime config has that writer's flag enabled. Flipping a
single writer's flag off (or `rollbackStage7`) instantly disables it.

---

## 4. Instant rollback mechanism (audit R1)

`functions/src/gamification/v4/rollback.ts` (emulator-gated).

- `rollbackStage7(db, familyId, reason, opts?)` — flips the family's cutover
  config to `rolled_back` and resets **every** writer flag to legacy in a
  **single document write**. No hosting redeploy, no code change. This is the
  "instant" mechanism: cutover is a flag, so rollback is a flag flip.
- `recordRollbackEvent(db, familyId, event)` — appends an immutable,
  append-only audit record under `families/{familyId}/gamification_rollback_audit/{id}`.
- `purgeV4FamilyData(db, familyId)` — the deeper, data-level rollback: deletes
  the V4 ledger, state and migration marker for a family (used when a family is
  fully reverted off V4).

All three call `assertEmulatorOnly`; none is referenced by
`functions/src/index.ts`, so rollback is test/tooling-only and never a deployed
production write path.

> **Wallet restore:** the migration marker already proves `walletHash BEFORE ==
> AFTER`, so wallet values are unchanged by V4. A full wallet-snapshot restore
> (audit improvement #7) remains a separate, manual operator step and is **not**
> automated here.

---

## 5. GATE 3 exit criteria (as executable checks)

GATE 3 ("before writer cutover") is satisfied only when **all** hold, and each
is now enforced by code + tests:

| # | Criterion | Enforced by | Tested by |
|---|-----------|-------------|-----------|
| 1 | Every legacy writer has a runtime kill switch | `featureFlags.ts` (`ALL_WRITERS`, 7 entries) | `featureFlags.test.ts` |
| 2 | Default is fail-closed (all legacy) | `defaultFeatureFlags()` | `featureFlags.test.ts` |
| 3 | Per-family / per-writer routing works | `resolveWriterRoute` + `familyOverrides` | `featureFlags.test.ts` |
| 4 | Cutover config persists + reads fail-closed | `cutoverConfig.ts` | `cutoverConfig.test.ts` |
| 5 | Stage 7 gate blocks on Gate 1/2/Stage 6 failure | `assertStage7Allowed` | `stage7Gate.test.ts` |
| 6 | Per-writer cutover guard (GATE 3 granularity) | `assertWriterCutoverAllowed` | `stage7Gate.test.ts` |
| 7 | Instant rollback flips all writers to legacy | `rollbackStage7` | `rollback.test.ts` + emulator |
| 8 | Emulator-only guard on every new I/O entry point | `assertEmulatorOnly` | architecture boundary test |
| 9 | End-to-end on real emulator | — | `stage7.emulator.test.ts` |

---

## 6. Stage 7 runbook (dry, infrastructure-only)

> This runbook describes how the *infrastructure* is exercised. **It is not
> executed as part of this P0** — no cutover is performed.

1. Confirm Gate 1 replay report is `GATE_1_REACHED` and Gate 2 marker
   `walletHashOk === true`.
2. Run `verifyPreCutover(familyId, …)` — must pass all six checks.
3. `assertStage7Allowed({ db, report, familyId })` — must not throw.
4. Canary: `setWriterFlag(db, familyId, 'behaviour', true)` then re-point only
   that writer in the deployed function (a later, deploy-gated task).
5. Full cutover: `activateStage7(db, familyId, { flags: withAllV4() })`.
6. Rollback if needed: `rollbackStage7(db, familyId, 'reason')` — instant.

---

## 7. Rollback procedure

1. **Instant (preferred):** `rollbackStage7(db, familyId, reason)`. Single write;
   all writers return to legacy immediately. No redeploy.
2. **Data-level (if reverting fully off V4):** `purgeV4FamilyData(db, familyId)`
   deletes the V4 ledger/state/marker. The legacy system is untouched and
   remains authoritative.
3. **Audit:** every rollback appends a record in
   `gamification_rollback_audit`; review before any re-cutover.

---

## 8. Files added (this P0)

| File | Role | Guard |
|------|------|-------|
| `src/domain/gamification/v4/featureFlags.ts` | feature flag framework (pure) | none (pure) |
| `src/domain/gamification/v4/featureFlags.test.ts` | flag tests | — |
| `src/domain/gamification/v4/stage7Readiness.ts` | pure GATE 3 decision core | none (pure) |
| `src/domain/gamification/v4/stage7Readiness.test.ts` | readiness tests | — |
| `functions/src/gamification/v4/cutoverConfig.ts` | runtime cutover config layer | `assertEmulatorOnly` |
| `functions/src/gamification/v4/cutoverConfig.test.ts` | config tests | — |
| `functions/src/gamification/v4/stage7Gate.ts` | mandatory Stage 7 gate | `assertEmulatorOnly` |
| `functions/src/gamification/v4/stage7Gate.test.ts` | gate tests | — |
| `functions/src/gamification/v4/rollback.ts` | instant rollback | `assertEmulatorOnly` |
| `functions/src/gamification/v4/rollback.test.ts` | rollback tests | — |
| `functions/src/gamification/v4/stage7.emulator.test.ts` | emulator integration | `assertEmulatorOnly` |
| `tools/architecture/v4-cutover-boundary.test.ts` | extended boundary guard | — |

**None of these is imported by `functions/src/index.ts`.** Stage 7 writer
cutover remains unstarted.
