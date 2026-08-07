# Gamification V4 — Pre-Cutover Verification Report (Task 6.1)

**Gate:** `verifyPreCutover(familyId, deps)` — Stage 6, Task 6.1
**Status:** FAIL-CLOSED. Cutover to V4 is permitted for a family **only** when every one of the six checks below passes.
**Baseline commit:** `70fbb6a6d49aa78f1b0ef64d45b2cd68006ecfc1`

---

## 1. What the gate consumes (no re-implementation)

The gate reuses existing, already-verified artifacts. It introduces **no second verification arithmetic path**:

| Input | Source | Reused, not duplicated |
| --- | --- | --- |
| Gate 1 replay report | `scripts/replay/production-report.ts` (`ProductionReplayReport`, `gate: GATE_1_REACHED`) | member classification, malformed/ambiguous counts, replayed state |
| Task 5.2 migration marker | `scripts/migrate/migration-marker.ts` (`MigrationMarkerV4`, `migrationMarkerDocPath`) | wallet hash BEFORE == AFTER, idempotency proof |
| Stage 4 repository | `functions/src/gamification/v4/repository.ts` | `readLedger`, `readState`, `assertEmulatorOnly` |
| Stage 4 rebuild | `src/domain/gamification/v4/rebuild.ts` | `rebuildStateFromLedger` (the SOLE state builder) |
| Stage 4 types | `src/domain/gamification/v4/types.ts` | `businessFields` (canonical comparison) |
| Task 5.2 no-op proof | `scripts/migrate/migration-marker.ts` | `rerunIsNoOp` |

---

## 2. The six checks (all must pass)

| # | Check | How it is verified | Fail condition |
| --- | --- | --- | --- |
| 1 | **Stored state == rebuild** | For each member, `businessFields(readState)` is compared to `businessFields(rebuildStateFromLedger(memberLedger, ctx))` using the **same** `ctx` (`updatedAt: report.generatedAt, projectionVersion: 1`) that Task 5.1 used. | Any member's stored state diverges from the canonical rebuild. |
| 2 | **Every member classified / accounted for** | The set of report members, ledger member ids, and stored state doc ids must be identical. | A member missing a ledger event, missing a state doc, or a state doc with no Gate 1 classification. |
| 3 | **No unexplained malformed / ambiguous records** | `report.counts.malformed === 0`, `report.counts.ambiguous === 0`, no per-family replay error, and every stored ledger event passes `assertValidEventV4`. | Any malformed/ambiguous source or invalid ledger event. |
| 4 | **Wallet hash BEFORE == AFTER** | The Task 5.2 marker's `walletHashOk` must be `true` and `marker.familyId === familyId`. | Missing marker, wrong family, or `walletHashOk === false`. |
| 5 | **No cross-family contamination** | Every ledger event's `familyId === familyId`; every stored state doc id is a classified member of this family. | Any cross-family event or extra/orphaned state doc. |
| 6 | **Duplicate migration run is a no-op** | Reuses Task 5.2 `rerunIsNoOp(report, db)`: captures the ledger+state hash, re-executes `writeMigrationLedger`, and asserts the hash is unchanged. | The rerun changes any ledger/state document. |

---

## 3. Fail-closed guarantees

- Empty / missing migration marker ⇒ **FAIL** (check 4, and check 6 cannot be proven).
- Wallet hash mismatch ⇒ **FAIL** (check 4).
- Missing member state ⇒ **FAIL** (checks 1 & 2).
- Extra cross-family event/state ⇒ **FAIL** (check 5, and check 2).
- Ledger/state divergence ⇒ **FAIL** (check 1).
- Unexplained source (malformed/ambiguous) ⇒ **FAIL** (check 3).
- Every failing check is reported **explicitly** in the returned `PreCutoverReport.checks[]`; the gate never returns a bare boolean.

---

## 4. Deterministic report output

`verifyPreCutover` returns a `PreCutoverReport`:

```ts
interface PreCutoverReport {
  familyId: string
  passed: boolean                 // true ONLY if all six checks pass
  generatedAt: string             // derived from marker.migratedAt (never wall clock)
  checks: ReadonlyArray<{ name: string; passed: boolean; detail: string }>  // fixed order 1..6
  markerPresent: boolean
  walletHashOk: boolean | null
}
```

The `checks` array is always emitted in the same order (1→6) and the timestamp is derived from the marker, so identical Firestore state yields a byte-identical JSON report. This is asserted by the `report is deterministic` test.

---

## 5. Test evidence (real Firestore emulator)

Run with: `firebase emulators:exec --only firestore 'npx vitest run scripts/verify/pre-cutover.test.ts'`

| Scenario | Expected | Result |
| --- | --- | --- |
| All six green | PASS | ✅ |
| Ledger/state mismatch | FAIL (check 1) | ✅ |
| Missing state | FAIL (checks 1 & 2) | ✅ |
| Malformed/ambiguous report | FAIL (check 3) | ✅ |
| Malformed ledger event | FAIL (check 3) | ✅ |
| Wallet hash mismatch | FAIL (check 4) | ✅ |
| Missing migration marker | FAIL (checks 4 & 6) | ✅ |
| Cross-family event | FAIL (check 5) | ✅ |
| Extra cross-family state | FAIL (checks 2 & 5) | ✅ |
| Duplicate migration changes state | FAIL (check 6) | ✅ |
| Report deterministic | identical JSON | ✅ |
| All six green via **real emulator** | PASS | ✅ |
| Missing marker via **real emulator** | FAIL | ✅ |

**Totals:** 13/13 Task 6.1 tests pass (in-memory Firestore double + real Firestore emulator integration).

Dependent suites also green: Task 5.1 (`write-v4-ledger.test.ts`), Task 5.2 (`migration-marker.test.ts`), Stage 4 rebuild/reducer/validators/ids/storage (`src/domain/gamification/v4/*`), full V4 replay (`scripts/replay/*`), architecture import-hygiene, freeze guard, and inventory check.

---

## 6. How to run before cutover

```bash
# 1. Ensure the approved Gate 1 report exists (docs/gamification-v4/03-production-replay-report.json)
# 2. Run Task 5.1 + 5.2 to populate the V4 ledger/state + marker on the EMULATOR ONLY
# 3. For each family in the report:
npx tsx -e "import('./scripts/verify/pre-cutover.ts').then(m => m.verifyPreCutover(familyId, { db, report, marker: undefined }))"
# 4. Cut over ONLY when every family's report.passed === true.
```

The gate is emulator-only (`assertEmulatorOnly`); it can never target production Firestore and never reads or writes wallet values.
