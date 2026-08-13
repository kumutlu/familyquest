# Gamification Integrity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair canonical XP rebuild, challenge closure, finalizer serialization, UI semantics, and Functions deployment provenance without production writes.

**Architecture:** Normalize all ledger documents through a pure fail-closed boundary before folding. Run rebuild through a generation-owned server executor that atomically publishes the summary and compatibility mirror. Keep challenge, UI, serialization, and deployment changes as independent TDD slices.

**Tech Stack:** TypeScript, Firebase Admin/Firestore, Vitest, React Testing Library, Vite, Firebase CLI.

## Global Constraints

- Preserve commits `640e23e`, `8fe1352`, and `2dfb19d`.
- Canonical totals are 866, 595, and 797; do not award the challenge again.
- Do not mutate production, deploy, change Firestore rules, or add client balance writers.
- Unknown XP-bearing input fails closed with diagnostics.
- Use deterministic deferred-operation concurrency tests, never sleeps.

---

### Task 1: Normalize historical rebuild input

**Files:** create a focused normalizer and fixtures under `src/domain/gamification/`; modify `functions/src/gamificationRepository.ts`; add domain and repository tests.

- [ ] Add literal production-shaped fixtures covering canonical task, behavior, challenge, baseline, both known Mnalium legacy shapes, and unknown malformed XP.
- [ ] Run focused tests and verify failure because optional ordering fields are omitted or unknown input is accepted/dropped.
- [ ] Implement a pure normalizer returning canonical event/order data or a document-scoped diagnostic.
- [ ] Replace the field-dependent event query with complete document retrieval and normalized in-memory deterministic ordering/checkpointing.
- [ ] Prove folds of 866/595/797, no baseline overlap removal, legacy inclusion, and unknown fail-closed behavior.
- [ ] Commit `fix(gamification): normalize historical XP rebuild input`.

### Task 2: Deterministic rebuild lifecycle

**Files:** modify `functions/src/gamificationRepository.ts`, `functions/src/gamificationRepair.ts`, and trusted server/admin wiring; add lifecycle/concurrency tests and a read-only dry-run entry point.

- [ ] Add failing tests for required vs owned rebuilding vs failed, stale-generation publication, live-event invalidation, atomic summary/mirror publication, and second-run no-op.
- [ ] Implement explicit state transitions and generation ownership using existing checkpoint documents.
- [ ] Implement server/admin-only execution and read-only dry-run reporting; expose no client callable.
- [ ] Verify deterministic deferred-operation tests and commit `fix(gamification): make rebuild lifecycle deterministic`.

### Task 3: Challenge confirmation invariant

**Files:** modify `functions/src/challengeClaim.ts` and `functions/src/challengeClaim.test.ts`.

- [ ] Add failing tests for ignored, missing, failed, unverified, repaired, processed, and verified-duplicate outcomes.
- [ ] Require every initially eligible child to be confirmed before close/feed/notification side effects.
- [ ] Prove retry repairs partial state without double reward and commit `fix(challenge): require complete reward confirmation`.

### Task 4: Undefined-safe finalizer serialization

**Files:** modify the trusted finalizer/repository serialization boundary and its focused tests.

- [ ] Add the observed legacy projection fixture and verify the write payload contains `currentStreak: undefined` before the fix.
- [ ] Normalize only undefined serialization values while preserving streak calculation semantics.
- [ ] Verify no server write payload contains undefined and commit `fix(gamification): sanitize finalizer projections`.

### Task 5: UI semantic clarity

**Files:** modify `src/components/parent/dashboard/ChildSummaryCard.tsx`, its tests, `src/pages/Family.tsx`, Family tests, and EN/TR family translations.

- [ ] Add failing tests showing total XP separately from next-level XP using 866/134, 595/405, and 797/203.
- [ ] Render authoritative resolved-summary total and progress separately.
- [ ] Add failing EN/TR ranking-copy tests while retaining the existing Monday-Sunday approved-task-points calculation.
- [ ] Update localized wording and commit `fix(ui): clarify XP and weekly task points`.

### Task 6: Functions deployment provenance

**Files:** create `scripts/deploy-production-functions.mjs` and test; modify `package.json`; share existing guard helpers where useful.

- [ ] Add failing process-level tests for dirty, detached/local-only, wrong branch, unreachable HEAD, SHA mismatch, and permitted reviewed HEAD.
- [ ] Implement a fail-closed Functions-only deploy wrapper that builds and verifies provenance before invoking Firebase.
- [ ] Verify Hosting behavior remains unchanged and commit `chore(deploy): guard functions production provenance`.

### Task 7: Integrated verification and production dry runs

**Files:** no production source changes unless a new in-scope regression is proven by a failing test.

- [ ] Run all required focused and broader suites, web/Functions TypeScript, web/Functions builds, architecture checks, and relevant Firestore rules tests.
- [ ] Run `git diff --check` and confirm no new client XP/reward writer.
- [ ] Run the new real-family dry run twice with writes disabled.
- [ ] Confirm both outputs are byte-equivalent and report event counts, normalized legacy events, zero unknowns, zero duplicate reward application, levels, and XP-to-next-level.
- [ ] Enumerate documents a later approved repair would modify and provide backup/rollback steps.
- [ ] Stop before deployment or production mutation.
