# Stage 7 — Final Writer Readiness Audit

**Date:** 2026-08-08
**Scope:** Static + unit verification of the Stage 7 writer cutover surface.
**Constraints observed:** no deploy, no flag activation, no credentials requested, no production Firestore access. Every check below is source inspection or an offline (mock-Firestore) test run.

---

## 1. Verdict summary

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | All seven writers implemented | **PASS** | 7 `*Writer.ts` modules, all on shared [`writerCore.applyEventV4()`](functions/src/gamification/v4/writerCore.ts:89) |
| 2 | All writers route through the resolver | **PASS (with scope note)** | [`routingShim.ts`](functions/src/gamification/routingShim.ts:50) is the single decision point; see §3 |
| 3 | No dual-write possible | **PASS** | Resolver returns exactly one route; per-writer "no dual write" tests |
| 4 | Default production route remains legacy | **PASS** | [`defaultFeatureFlags()`](src/domain/gamification/v4/featureFlags.ts:83) sets every writer `false` |
| 5 | Rollback works | **PASS** | [`rollback.ts`](functions/src/gamification/v4/rollback.ts:1) + config-only TTL-bounded resolver |
| 6 | V4 boundary rules pass | **PASS** | 61/61 in [`v4-cutover-boundary.test.ts`](tools/architecture/v4-cutover-boundary.test.ts:1) |
| 7 | Final readiness report | **PASS** | This document |

**Overall: Stage 7 is implementation-complete and activation-ready. Stage 7 is NOT activated.**

---

## 2. Requirement 1 — all seven writers implemented

The audit §6 enumerates seven legacy authoritative writers. Each has a V4 counterpart:

| Writer flag | V4 module | Entry point |
|---|---|---|
| `task_approval` | [`taskApprovalWriter.ts`](functions/src/gamification/v4/taskApprovalWriter.ts:158) | `applyTaskApprovalV4` |
| `task_invalidation` | [`reversalWriter.ts`](functions/src/gamification/v4/reversalWriter.ts:134) | `applyReversalV4` |
| `day_finalization` | [`dayFinalizationWriter.ts`](functions/src/gamification/v4/dayFinalizationWriter.ts:172) | `applyDayFinalizationV4` |
| `behaviour` | [`behaviourWriter.ts`](functions/src/gamification/v4/behaviourWriter.ts:149) | `applyBehaviourV4` |
| `reward_redemption` | [`rewardRedemptionWriter.ts`](functions/src/gamification/v4/rewardRedemptionWriter.ts:142) | `applyRewardRedemptionV4` |
| `challenge_claim` | [`manualAdjustmentWriter.ts`](functions/src/gamification/v4/manualAdjustmentWriter.ts:136) | `applyManualAdjustmentV4` |
| `avatar_unlock` | [`avatarUnlockWriter.ts`](functions/src/gamification/v4/avatarUnlockWriter.ts:131) | `applyAvatarUnlockV4` |

The flag enum [`ALL_WRITERS`](src/domain/gamification/v4/featureFlags.ts:35) contains exactly these seven identifiers — no writer is unrepresented, and no flag lacks an implementation.

All seven share one write algorithm ([`writerCore.ts`](functions/src/gamification/v4/writerCore.ts:1)):
build one canonical deterministic event → probe the deterministic id (duplicate = no-op) → `writeEventIdempotent` → rebuild the member projection from the ledger. No writer performs its own arithmetic and none touches a legacy `rewardPoints` / `lifetimeXP` / wallet document.

**Test evidence:** `functions/src/gamification/v4` — **18 files, 244 passed, 6 skipped, 0 failed**.

---

## 3. Requirement 2 — all writers route through the resolver

Routing is layered, with exactly one decision function per surface:

- **Server (deployed):** [`resolveWriterRouteSafe()`](functions/src/gamification/routingShim.ts:50) — the single call every server writer makes. Its default resolver is all-legacy.
- **Server (runtime cutover):** [`runtimeCutoverConfig.ts`](functions/src/gamification/runtimeCutoverConfig.ts:1) reads the persisted config per invocation with a bounded cache (15 s default, 60 s hard max) and **fails legacy** on missing/malformed/unreadable config, unknown writer, empty familyId, or Firestore error.
- **Emulator / gated:** [`resolveStage7WriterRoute()`](functions/src/gamification/v4/routeResolver.ts:37) — the only path that can return `v4`, and it calls the mandatory [`assertStage7Allowed()`](functions/src/gamification/v4/stage7Gate.ts:1) first, throwing `Stage7BlockedError` (fail closed) on any Gate 1 / Gate 2 / Stage 6 failure.
- **Client:** [`requireLegacyClientRoute()`](src/lib/api.ts:89) resolves through the same pure `resolveWriterRoute` and refuses any non-legacy route.

Confirmed call sites (no writer bypasses the shim):

| Call site | Writer | Guard |
|---|---|---|
| [`gamificationProcessor.ts`](functions/src/gamificationProcessor.ts:111) | `task_approval` | `resolveWriterRouteSafe` + live `v4` branch |
| [`gamificationProcessor.ts`](functions/src/gamificationProcessor.ts:136) | `task_invalidation` | `requireLegacyRoute` |
| [`gamificationRepository.ts`](functions/src/gamificationRepository.ts:881) | `day_finalization` | `requireLegacyRoute` |
| [`behaviourRepository.ts`](functions/src/behaviourRepository.ts:53) | `behaviour` | `requireLegacyRoute` |
| [`src/lib/api.ts`](src/lib/api.ts:89) | `reward_redemption`, `challenge_claim`, `avatar_unlock` | `requireLegacyClientRoute` |

**Scope note (not a defect, a deliberate gate):** only `task_approval` (Task 7.1) has a live `route === 'v4'` branch wired into a deployed call site. Writers 7.2–7.7 are implemented, resolver-gated and emulator-verified, but their production call sites still assert `requireLegacyRoute`, i.e. they *fail closed* rather than silently branching. Promoting each remaining writer from "assert legacy" to "branch on route" is a per-writer activation step that requires GATE 3 authorisation and is explicitly out of scope here.

---

## 4. Requirement 3 — no dual-write possible

Structural guarantees:

1. `resolveWriterRoute` returns a single `WriterRoute` (`'legacy' | 'v4'`) — the type system offers no "both" value.
2. Each call site consumes one route and executes one engine; `requireLegacyRoute` throws instead of running both when a route unexpectedly resolves to `v4`.
3. V4 writers persist only to the V4 event + state collections; the boundary test asserts no legacy balance document is touched.
4. Duplicate delivery is a no-op via the deterministic event id used as the Firestore document id.

**Test evidence:** an explicit *"exactly one writer runs per route (no dual write)"* case exists for behaviour, day finalization, reward redemption, manual adjustment, reversal and avatar unlock; task approval is covered by *"touches only the V4 event + state collections (no dual write)"*; and `runtimeCutoverConfig` asserts *"returns exactly one route — never a dual write instruction"*.

---

## 5. Requirement 4 — default production route remains legacy

- [`defaultFeatureFlags()`](src/domain/gamification/v4/featureFlags.ts:83) sets all seven writers to `false` → `resolveWriterRoute` returns `legacy`.
- The routing shim's module-level default is `defaultRouteResolver()` (all-legacy); the cutover-aware resolver must be *injected* to change that, and [`functions/src/index.ts`](functions/src/index.ts:1) never calls `setRouteResolver`, `setWriterFlag` or `activateStage7` (asserted by the boundary test).
- The runtime resolver's every error/edge path resolves to `legacy` (`LEGACY_ROUTE`); there is no code path where a failure yields `v4`.
- The Stage 7 verifier fails closed when the Gate 1 artifact is unprovisioned; no evidence is baked into the deployed bundle.
- Client writers resolve against `defaultFeatureFlags()` only — a browser bundle cannot route itself to V4, and Firestore rules deny clients read *and* write on `gamification_cutover_config`.

**No flags were activated by this audit.** The production route for all seven writers is `legacy`.

---

## 6. Requirement 5 — rollback works

Rollback is a config flip, not a deploy:

- [`rollbackStage7()`](functions/src/gamification/v4/rollback.ts:1) sets the family config to `rolled_back` and resets **every** writer flag to legacy in a **single document write**.
- The deployed runtime re-reads the config per invocation behind a bounded cache, so a rollback takes effect within one TTL (≤ 60 s worst case) with **no hosting or functions redeploy** — this closes audit finding R1, which noted the highest-risk writers live in the SPA.
- `invalidate(familyId)` drops the cached config immediately after activate/rollback for near-instant effect.
- `recordRollbackEvent()` appends an immutable audit record; `purgeV4FamilyData()` provides data-level rollback (ledger / state / marker) and is emulator-gated.
- Rollback never mutates any legacy writer or document — it only resets flags and V4-owned collections.

**Test evidence:** `rollback.test.ts` (5 tests) and `runtimeCutoverConfig.test.ts` (19 tests) pass offline.

---

## 7. Requirement 6 — V4 boundary rules

`npx vitest run tools/architecture/v4-cutover-boundary.test.ts` → **61 passed, 0 failed.**

Enforced invariants:

- Only two `gamification/v4` references are reachable from `functions/src/index.ts`: the task-approval adapter and the read-only Stage 7 evidence provider. Everything else is unreachable from the deployed bundle.
- No Stage 7 infrastructure module (`cutoverConfig`, `stage7Gate`, `rollback`, `featureFlags`, `stage7Readiness`) is referenced by the deploy entry, by name or by path.
- Every exported async I/O entry point under `functions/src/gamification/v4` calls `assertEmulatorOnly(...)`.
- The V4 domain layer (`src/domain/gamification/v4`) imports no firebase / firebase-admin — it stays pure.
- No `src/` module imports the server-side V4 repository.
- The Stage 7 verifier never writes; the evidence provider is read-only (no `set` / `update` / `delete` / transaction / batch).
- `index.ts` contains no embedded Gate 1 evidence and no `applicationDefault` credential usage.

---

## 8. Aggregate test results (offline)

| Suite | Result |
|---|---|
| `tools/architecture/v4-cutover-boundary.test.ts` | 61 passed |
| `functions/src/gamification/v4` (non-emulator) | 244 passed, 6 skipped |
| `src/domain/gamification/v4` | 225 passed |
| **Total** | **530 passed, 6 skipped, 0 failed** |

Emulator suites (`*.emulator.test.ts`) were **not** executed — they require a running emulator, and starting one is outside the read-only remit of this audit.

---

## 9. Residual risks / follow-ups (not blockers)

1. **Six writers await call-site promotion.** 7.2–7.7 are built and gated but their production call sites still `requireLegacyRoute`. Each needs a reviewed one-line promotion to a `route === 'v4'` branch at activation time.
2. **Emulator suites unverified in this pass.** Re-run `*.emulator.test.ts` against a live emulator immediately before GATE 3.
3. **Gate 1 artifact is unprovisioned by design.** `STAGE7_GATE1_ARTIFACT` must be supplied out-of-band by an operator; until then the verifier blocks — correct, but it means activation readiness cannot be proven end-to-end from source alone.
4. **Cache TTL trade-off.** Worst-case rollback latency is one TTL (≤ 60 s). Acceptable, but the TTL should be lowered for the canary window.

---

## 10. Conclusion

All seven Stage 7 writers are implemented on a single shared write core, are gated by a single routing decision point, cannot dual-write, and default to legacy on every surface and every error path. Rollback is a single-document config flip effective within one cache TTL without a redeploy. All V4 architecture boundary rules pass.

**Stage 7 is ready for a GATE 3 activation decision. No deployment, flag activation, or credential access was performed.**
