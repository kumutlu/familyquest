# Gamification V4 — Implementation Plan (TDD-first, reviewable stages)

> **Status:** PLAN ONLY. No production code, no Firestore writes, no deploy, no architecture docs, no wallet access.
> **Source of truth:** [`docs/gamification-v4-design.md`](docs/gamification-v4-design.md) (approved).
> **Wallet is OUT OF SCOPE.** Every migration test must prove wallet documents are byte-identical before and after. Gamification code paths must never import wallet modules.
> **Replay is authoritative.** Displayed Reward Points / XP / streak never override the historical replay result.
> **No hidden compatibility values.** V4 state must be rebuildable entirely from the V4 event ledger.

---

## 0. How to read this plan

- Each **Stage** is a logical phase. Each **Task** is a small, independently reviewable unit (≤5 production files, ≤3 test files, ≤500 line diff).
- Every task lists: **exact files**, **functions/types introduced**, **existing files modified**, **failing test**, **red command**, **minimum implementation**, **green command**, **commit message**, **rollback checkpoint**, **acceptance criteria**.
- **Red command** = the command that must FAIL before the implementation exists (TDD-first). **Green command** = the same command that must PASS after the minimum implementation.
- **Approval gates** are hard stops. No task may silently pass one.

### Test runner conventions
- Unit/domain tests: `npm run test -- <path>` (Vitest).
- Functions tests: `npm run test:functions` (if configured) or `npx vitest run functions/src/...`.
- E2E: `npx playwright test --config playwright.config.ts`.
- Lint/typecheck: `npm run lint && npm run typecheck`.
- CI guard: `node scripts/gamification-freeze-guard.cjs --check`.

---

## 1. Stage / Task breakdown (summary)

| Stage | Title | Tasks |
|---|---|---|
| 0 | Freeze and protect current production | 0.1, 0.2, 0.3, 0.4 |
| 1 | Pure V4 domain engine | 1.1 … 1.10 |
| 2 | Historical replay dry-run | 2.1 … 2.4 |
| 3 | Production replay report | 3.1 **(GATE 1)** |
| 4 | V4 storage and server repositories | 4.1 … 4.4 |
| 5 | Write migration | 5.1, 5.2 **(GATE 2)** |
| 6 | Verification before cutover | 6.1 **(GATE 2 exit)** |
| 7 | Controlled writer cutover | 7.1 … 7.7 **(GATE 3)** |
| 8 | One UI read model | 8.1 … 8.7 **(GATE 4)** |
| 9 | Remove legacy system | 9.1 … 9.5 **(GATE 5)** |

**Total task count: 47.**

---

## 2. STAGE 0 — Freeze and protect current production

Goal: inventory every current gamification writer/reader, lock the legacy surface, back up gamification collections, and snapshot wallet documents for later byte-equality verification. **No runtime behaviour change.**

### Task 0.1 — Extend the freeze inventory document
- **Exact files:** `docs/gamification-v4/00-freeze-inventory.md` (new), `scripts/gamification-inventory.cjs` (extend TERMS with V4 terms).
- **Functions/types introduced:** `TERMS` additions: `gamification_events`, `gamification_state`, `resolveGamificationState`, `approveTaskCompletion`, `recordBehaviour`, `redeemReward`, `reverseEvent`, `finalizeDailyGoals`, `unlockAvatar`, `manualAdjustment`.
- **Existing files modified:** `scripts/gamification-inventory.cjs`.
- **Failing test:** `node scripts/gamification-inventory.cjs --check` fails because the new doc region is missing.
- **Red command:** `node scripts/gamification-inventory.cjs --check`
- **Minimum implementation:** Run the inventory script to regenerate `docs/gamification-v3/05-current-state-inventory.md`, then author `docs/gamification-v4/00-freeze-inventory.md` listing every writer (client `rewardPoints` writes in `src/lib/api.ts`, `src/lib/reversalApi.ts`, `src/lib/behaviour.ts`, challenge claim in `src/lib/api.ts`) and every reader (`src/lib/gamificationAdapters.ts`, `src/lib/achievements.ts`, `src/components/parent/dashboard/ChildSummaryCard.tsx`, `src/pages/MemberProfile.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Rewards.tsx`, `src/pages/Family.tsx`).
- **Green command:** `node scripts/gamification-inventory.cjs --check`
- **Commit message:** `docs(gam-v4): stage0 freeze inventory of gamification writers/readers`
- **Rollback checkpoint:** Pure documentation; revert the two files.
- **Acceptance criteria:** Inventory enumerates ≥ all writers found in `src/lib/api.ts` (`redeemReward`, `claimChallenge`, avatar unlock ~line 3089, behaviour via `onBehaviourEventCreated`), `src/lib/reversalApi.ts`, and all UI readers; no code behaviour changed.

### Task 0.2 — Add CI guard "no new legacy gamification writers"
- **Exact files:** `scripts/gamification-freeze-guard.cjs` (new), `.github/workflows/ci.yml` or `package.json` `scripts.ci:freeze` (modify), `docs/gamification-v4/00-freeze-inventory.md` (append guard contract).
- **Functions/types introduced:** `FORBIDDEN_WRITER_PATTERNS` (regex list matching `transaction.update(userRef, { rewardPoints`, `lifetimeXP`, direct `rewardPoints` writes outside `src/domain/gamification/v4` and `functions/src/gamification/v4`).
- **Existing files modified:** `package.json` (add `ci:freeze` script), CI workflow.
- **Failing test:** `node scripts/gamification-freeze-guard.cjs --check` fails (script absent).
- **Red command:** `node scripts/gamification-freeze-guard.cjs --check`
- **Minimum implementation:** Script greps `git ls-files` `src/` + `functions/src/` for forbidden writer patterns; exits non-zero if a NEW legacy writer appears outside the allowed V4 directories. Wire into CI.
- **Green command:** `node scripts/gamification-freeze-guard.cjs --check`
- **Commit message:** `ci(gam-v4): add freeze guard rejecting new legacy gamification writers`
- **Rollback checkpoint:** Remove the CI step + script; no runtime impact.
- **Acceptance criteria:** Guard passes on current tree; deliberately adding a `rewardPoints` write in `src/lib/api.ts` makes it fail (verified locally, then reverted).

### Task 0.3 — Back up production gamification collections (read-only export)
- **Exact files:** `scripts/backup-gamification-collections.cjs` (new), `backups/gamification/<timestamp>/` (output, git-ignored).
- **Functions/types introduced:** `backupCollection(familyId, 'gamification_summaries' | 'daily_progress' | 'task_occurrences' | 'behaviour_events')`, `writeBackupManifest()`.
- **Existing files modified:** none (read-only script).
- **Failing test:** `node scripts/backup-gamification-collections.cjs --dry-run` fails (script absent).
- **Red command:** `node scripts/backup-gamification-collections.cjs --dry-run`
- **Minimum implementation:** Admin-SDK read-only export of gamification collections per family into `backups/gamification/<timestamp>/`; never touches wallet collections.
- **Green command:** `node scripts/backup-gamification-collections.cjs --dry-run`
- **Commit message:** `chore(gam-v4): read-only production gamification backup script`
- **Rollback checkpoint:** Delete the backup directory; no prod impact.
- **Acceptance criteria:** Script lists families and collection counts without writing anything; wallet collections are NOT in scope.

### Task 0.4 — Hash wallet documents for later equality verification
- **Exact files:** `scripts/wallet-snapshot.cjs` (new), `backups/wallet-snapshots/<timestamp>/wallet_snapshots.json` (artifact, git-ignored).
- **Functions/types introduced:** `WalletSnapshot` (`{ familyId, docPath, sha256 }`), `hashWalletDocs()`, `writeWalletSnapshot()`.
- **Existing files modified:** none.
- **Failing test:** `node scripts/wallet-snapshot.cjs --check` fails (absent).
- **Red command:** `node scripts/wallet-snapshot.cjs --check`
- **Minimum implementation:** Compute SHA-256 of every wallet-related document (wallet balances, wallet transactions, allowances, Pet Box, savings, money transfers) per family/member; store in immutable `wallet_snapshots` artifact. **Aborts if any gamification code path is imported.**
- **Green command:** `node scripts/wallet-snapshot.cjs --check`
- **Commit message:** `chore(gam-v4): snapshot wallet document hashes for equality verification`
- **Rollback checkpoint:** Delete artifact; no prod impact.
- **Acceptance criteria:** Artifact contains one hash per wallet doc path; re-running on unchanged data yields identical hashes (idempotent). **Mandatory test #14 anchor.**

---

## 3. STAGE 1 — Pure V4 domain engine

Goal: implement only pure TypeScript (no Firestore imports). Invariant: **same ledger → byte-identical business state.**

New module root: `src/domain/gamification/v4/`.

### Task 1.1 — V4 event + state contracts
- **Exact files:** `src/domain/gamification/v4/types.ts` (new), `src/domain/gamification/v4/event.ts` (new), `src/domain/gamification/v4/types.test.ts` (new).
- **Functions/types introduced:** `GamificationEventV4` (all fields from design §2.1), `GamificationStateV4` (§2.4), `GamificationEventTypeV4` enum (§2.2), `SOURCE_TYPE`, `ESTIMATED_FLAG`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/types.test.ts` fails (file absent).
- **Red command:** `npm run test -- src/domain/gamification/v4/types.test.ts`
- **Minimum implementation:** Type definitions + a `businessFields(state)` selector returning only the authoritative fields (rewardPoints, xpTotal, level, xpProgressInLevel, xpToNextLevel, levelProgressPercentage, currentStreak, bestStreak, lastQualifiedDayKey, unlockedAchievementIds, unlockedAvatarIds). No logic yet.
- **Green command:** `npm run test -- src/domain/gamification/v4/types.test.ts`
- **Commit message:** `feat(gam-v4): event and state type contracts`
- **Rollback checkpoint:** Delete the three files.
- **Acceptance criteria:** Types compile; `businessFields` returns the exact field set; no Firestore import. **Mandatory test #1 anchor (type shape).**

### Task 1.2 — Deterministic event IDs
- **Exact files:** `src/domain/gamification/v4/ids.ts` (new), `src/domain/gamification/v4/ids.test.ts` (new).
- **Functions/types introduced:** `eventIdFor(familyId, memberId, eventType, sourceId)`, `reversalEventId(originalEventId, kind: 'REV'|'REFUND')`, `MIGRATION_BASELINE_SOURCE_ID = 'BASELINE'`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/ids.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/ids.test.ts`
- **Minimum implementation:** `eventId = \`${familyId}::${memberId}::${eventType}::${sourceId}\``; reversals append `::REV`/`::REFUND`; baseline uses `BASELINE`. Pure, no randomness.
- **Green command:** `npm run test -- src/domain/gamification/v4/ids.test.ts`
- **Commit message:** `feat(gam-v4): deterministic event id derivation`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Same inputs → identical id; reversal id deterministic; cross-family ids differ. **Mandatory test #6 anchor (idempotent id).**

### Task 1.3 — Validators
- **Exact files:** `src/domain/gamification/v4/validators.ts` (new), `src/domain/gamification/v4/validators.test.ts` (new).
- **Functions/types introduced:** `assertValidEventV4(event)`, `assertValidStateV4(state)`, `ValidationErrorV4`, `assertNonNegativeRewardPoints`, `assertXpOnlyDecreasesViaReversal`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/validators.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/validators.test.ts`
- **Minimum implementation:** Integer checks, required-field checks, delta-sign rules per event type (mirror V3 `DELTA_RULES`), rewardPoints ≥ 0, xpDelta only negative when `reversalOfEventId` present.
- **Green command:** `npm run test -- src/domain/gamification/v4/validators.test.ts`
- **Commit message:** `feat(gam-v4): event and state validators`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Rejects negative rewardPoints state, rejects XP decrease without reversal, rejects illegal delta combos. **Mandatory tests #12, #13 anchors.**

### Task 1.4 — Canonical event ordering
- **Exact files:** `src/domain/gamification/v4/ordering.ts` (new), `src/domain/gamification/v4/ordering.test.ts` (new).
- **Functions/types introduced:** `canonicalOrder(events): GamificationEventV4[]`, `EVENT_PRECEDENCE_V4` (baseline 0 → earnings → spending → reversal last).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/ordering.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/ordering.test.ts`
- **Minimum implementation:** Sort by (effectiveAt, createdAt, eventType precedence, eventId). Stable tie-breaker.
- **Green command:** `npm run test -- src/domain/gamification/v4/ordering.test.ts`
- **Commit message:** `feat(gam-v4): canonical deterministic event ordering`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Shuffled input → identical ordered output; reversal always after its original at same timestamp.

### Task 1.5 — Level calculation (canonical)
- **Exact files:** `src/domain/gamification/v4/level.ts` (new), `src/domain/gamification/v4/level.test.ts` (new).
- **Functions/types introduced:** `levelForXp(xpTotal): { level, xpProgressInLevel, xpToNextLevel, levelProgressPercentage }`.
- **Existing files modified:** none (do NOT reuse `src/domain/gamification/level.ts` V1 formula blindly — define V4 canonical curve explicitly).
- **Failing test:** `npm run test -- src/domain/gamification/v4/level.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/level.test.ts`
- **Minimum implementation:** Single pure function; no UI formula; clamp 0–100 percentage.
- **Green command:** `npm run test -- src/domain/gamification/v4/level.test.ts`
- **Commit message:** `feat(gam-v4): canonical levelForXp`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Deterministic; matches design §3.3; pure.

### Task 1.6 — Streak calculation
- **Exact files:** `src/domain/gamification/v4/streak.ts` (new), `src/domain/gamification/v4/streak.test.ts` (new).
- **Functions/types introduced:** `computeStreak(events, asOfDayKey): { currentStreak, bestStreak, lastQualifiedDayKey }`, `dayKeyFor(ts)`, `daysBetweenDayKeys`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/streak.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/streak.test.ts`
- **Minimum implementation:** Fold `DAILY_GOAL_AWARDED`/`PERFECT_DAY_AWARDED` day keys; no `users` fallback.
- **Green command:** `npm run test -- src/domain/gamification/v4/streak.test.ts`
- **Commit message:** `feat(gam-v4): projection-derived streak engine`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Consecutive days increment; gap resets current but keeps bestStreak; pure.

### Task 1.7 — Achievement & avatar calculation
- **Exact files:** `src/domain/gamification/v4/achievements.ts` (new), `src/domain/gamification/v4/achievements.test.ts` (new).
- **Functions/types introduced:** `deriveAchievements(state): string[]`, `deriveUnlockedAvatars(state): string[]`.
- **Existing files modified:** none (new V4 module; legacy `src/lib/achievements.ts` untouched until Stage 9).
- **Failing test:** `npm run test -- src/domain/gamification/v4/achievements.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/achievements.test.ts`
- **Minimum implementation:** Pure derivation from xpTotal/level/streak/unlockedAvatarIds.
- **Green command:** `npm run test -- src/domain/gamification/v4/achievements.test.ts`
- **Commit message:** `feat(gam-v4): projection-derived achievements and avatars`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Pure; no UI unlock logic; deterministic.

### Task 1.8 — Reversal handling
- **Exact files:** `src/domain/gamification/v4/reversal.ts` (new), `src/domain/gamification/v4/reversal.test.ts` (new).
- **Functions/types introduced:** `buildReversalEvent(original, kind)`, `isReversalOf(event, originalEventId)`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/reversal.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/reversal.test.ts`
- **Minimum implementation:** Produce a reversal event that negates exactly one original (same deltas negated, `reversalOfEventId` set, id via `reversalEventId`).
- **Green command:** `npm run test -- src/domain/gamification/v4/reversal.test.ts`
- **Commit message:** `feat(gam-v4): reversal event construction`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Reversal references exactly one original; idempotent id. **Mandatory test #5 anchor.**

### Task 1.9 — Reducer / projection fold
- **Exact files:** `src/domain/gamification/v4/reducer.ts` (new), `src/domain/gamification/v4/reducer.test.ts` (new).
- **Functions/types introduced:** `reduceGamificationEventsV4(events, ctx): GamificationStateV4`, `foldEvent(state, event): GamificationStateV4`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/reducer.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/reducer.test.ts`
- **Minimum implementation:** Pure fold: clamp rewardPoints ≥ 0; XP only decreases via reversal; apply level/streak/achievement derivation; set `foldedThroughEventId`, `projectionVersion`, `updatedAt` (from ctx).
- **Green command:** `npm run test -- src/domain/gamification/v4/reducer.test.ts`
- **Commit message:** `feat(gam-v4): pure projection reducer`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** **Mandatory tests #1 (task +20→RP+20/XP+20), #2 (positive behaviour +20), #3 (negative −5→RP−5/XP unchanged), #4 (redemption −10→RP−10/XP unchanged), #5 (reversal cancels one), #12 (RP never negative), #13 (XP only via reversal).** All encoded as failing-first tests in this file.

### Task 1.10 — Projection rebuild from ledger
- **Exact files:** `src/domain/gamification/v4/rebuild.ts` (new), `src/domain/gamification/v4/rebuild.test.ts` (new).
- **Functions/types introduced:** `rebuildStateFromLedger(events, ctx): GamificationStateV4`, `rebuildAllMembers(ledger, ctx): Record<memberId, GamificationStateV4>`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/rebuild.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/rebuild.test.ts`
- **Minimum implementation:** Order events canonically, reduce, return per-member state. Assert `rebuild === reduce` (byte-identical business fields).
- **Green command:** `npm run test -- src/domain/gamification/v4/rebuild.test.ts`
- **Commit message:** `feat(gam-v4): ledger rebuild equals reducer output`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** **Mandatory test #8 (projection deletion + ledger rebuild gives identical state).** Same ledger → byte-identical state (invariant proof).

---

## 4. STAGE 2 — Historical replay dry-run

Goal: read-only replay tool covering all 7 source classes; classify each generated event; emit a per-event report. **No writes.**

New root: `src/domain/gamification/v4/replay/` and `scripts/replay/`.

### Task 2.1 — Legacy source readers (read-only)
- **Exact files:** `src/domain/gamification/v4/replay/sources.ts` (new), `src/domain/gamification/v4/replay/sources.test.ts` (new).
- **Functions/types introduced:** `readTaskCompletions(family)`, `readBehaviours(family)`, `readDailyPerfectDay(family)`, `readRedemptions(family)`, `readRefundsReversals(family)`, `readAvatarUnlocks(family)`, `readManualAdjustments(family)`.
- **Existing files modified:** none (readers import only legacy collection shapes, never wallet).
- **Failing test:** `npm run test -- src/domain/gamification/v4/replay/sources.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/replay/sources.ts` (absent)
- **Minimum implementation:** Pure mappers from legacy docs → replay input records; never import wallet modules.
- **Green command:** `npm run test -- src/domain/gamification/v4/replay/sources.test.ts`
- **Commit message:** `feat(gam-v4): read-only legacy source readers for replay`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Each reader returns typed records with `sourceId`, `effectiveAt`, `createdAt`, raw reward snapshot.

### Task 2.2 — Classification engine
- **Exact files:** `src/domain/gamification/v4/replay/classify.ts` (new), `src/domain/gamification/v4/replay/classify.test.ts` (new).
- **Functions/types introduced:** `classify(source): 'exact'|'estimated'|'malformed'|'ambiguous'|'skipped'`, `selectRewardPoints(task, snapshot)`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/replay/classify.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/replay/classify.test.ts`
- **Minimum implementation:** Use `effectSnapshot.awardedPoints` if present → exact; else current task points → estimated=true; missing required fields → malformed (never guess); conflicting sources for one sourceId → ambiguous (never guess); wallet-linked/out-of-family → skipped.
- **Green command:** `npm run test -- src/domain/gamification/v4/replay/classify.test.ts`
- **Commit message:** `feat(gam-v4): replay classification (exact/estimated/malformed/ambiguous/skipped)`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** **Mandatory test #7 (missing task snapshot uses current points + estimated=true).** Malformed/ambiguous never guessed.

### Task 2.3 — Replay report emitter
- **Exact files:** `src/domain/gamification/v4/replay/report.ts` (new), `src/domain/gamification/v4/replay/report.test.ts` (new).
- **Functions/types introduced:** `ReplayReportRow` (source document, eventId, exact/estimated, rewardPointsDelta, xpDelta, timestamp, classification, skip/ambiguity reason), `emitReport(rows): ReplayReport`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- src/domain/gamification/v4/replay/report.test.ts` fails.
- **Red command:** `npm run test -- src/domain/gamification/v4/replay/report.test.ts`
- **Minimum implementation:** Build per-event rows + aggregate counts (exact, estimated, malformed, ambiguous, skipped).
- **Green command:** `npm run test -- src/domain/gamification/v4/replay/report.test.ts`
- **Commit message:** `feat(gam-v4): replay per-event report emitter`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Every generated event has all required report columns; counts sum correctly.

### Task 2.4 — Replay CLI dry-run (no writes)
- **Exact files:** `scripts/replay/run-dry-run.ts` (new), `scripts/replay/run-dry-run.test.ts` (new).
- **Functions/types introduced:** `runReplayDryRun(familyId): ReplayReport`, CLI `--family` / `--all-families` (emulator only).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- scripts/replay/run-dry-run.test.ts` fails.
- **Red command:** `npm run test -- scripts/replay/run-dry-run.test.ts`
- **Minimum implementation:** Orchestrate sources → classify → build deterministic events → reduce → emit report. **Asserts zero Firestore writes** (no `set`/`update` on gamification collections).
- **Green command:** `npm run test -- scripts/replay/run-dry-run.test.ts`
- **Commit message:** `feat(gam-v4): read-only replay dry-run CLI`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Dry-run produces a report and performs no writes (verified by a spy on Firestore writes).

---

## 5. STAGE 3 — Production replay report  ⛔ GATE 1

Goal: run read-only replay against **every** production family; produce per-family/member totals and difference from currently displayed data. Wallet values listed only as protected hashes. **Stop for approval after this report.**

### Task 3.1 — Production replay report across all families
- **Exact files:** `scripts/replay/production-report.ts` (new), `scripts/replay/production-report.test.ts` (new), `docs/gamification-v4/03-production-replay-report.md` (generated artifact).
- **Functions/types introduced:** `runProductionReplay(): ProductionReplayReport` (per-family totals, per-member replayed RP/XP/streak/achievements, exact/estimated/malformed/ambiguous/skipped counts, difference vs displayed, wallet hashes only).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- scripts/replay/production-report.test.ts` fails.
- **Red command:** `npm run test -- scripts/replay/production-report.test.ts`
- **Minimum implementation:** Reuse Stage 2 engine; aggregate; embed `wallet_snapshots` hashes (never treat as gamification inputs); emit markdown + JSON.
- **Green command:** `npm run test -- scripts/replay/production-report.test.ts`
- **Commit message:** `feat(gam-v4): production replay report generator`
- **Rollback checkpoint:** Delete generated artifact + scripts; no prod impact.
- **Acceptance criteria:** Report contains every required metric; wallet shown only as hashes; **GATE 1 reached — owner approval required before Stage 4.**

---

## 6. STAGE 4 — V4 storage and server repositories

Goal: only after replay approval. Create `gamification_events` + `gamification_state`, server-only repositories, Firestore Rules denying client writes, deterministic projection rebuild, durable failure records. **Do not connect production writers yet.**

New root: `functions/src/gamification/v4/`.

### Task 4.1 — Server repositories (write-once, idempotent)
- **Exact files:** `functions/src/gamification/v4/repository.ts` (new), `functions/src/gamification/v4/repository.test.ts` (new).
- **Functions/types introduced:** `writeEventIdempotent(db, event)`, `readLedger(familyId)`, `writeState(db, memberId, state)`, `rejectCrossFamily(event)` (abort if `familyId` mismatch with partition).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- functions/src/gamification/v4/repository.test.ts` fails.
- **Red command:** `npm run test -- functions/src/gamification/v4/repository.test.ts`
- **Minimum implementation:** Deterministic doc id = eventId; same id overwrites (no double award); cross-family write aborts.
- **Green command:** `npm run test -- functions/src/gamification/v4/repository.test.ts`
- **Commit message:** `feat(gam-v4): server-only idempotent event/state repositories`
- **Rollback checkpoint:** Delete the two files; no client exposure.
- **Acceptance criteria:** **Mandatory test #11 (cross-family event rejected), #6 (duplicate delivery no-op at storage layer).**

### Task 4.2 — Firestore Rules denying client writes
- **Exact files:** `firestore.rules` (modify), `firestore.rules.test.ts` (new, emulator rules unit test).
- **Functions/types introduced:** `match /families/{fid}/gamification_events/{eid} { allow read: if member; allow write: if false; }`, same for `gamification_state`.
- **Existing files modified:** `firestore.rules`.
- **Failing test:** `npm run test -- firestore.rules.test.ts` fails (rules absent).
- **Red command:** `npm run test -- firestore.rules.test.ts`
- **Minimum implementation:** Deny all client writes to both collections; allow read for family members; keep wallet rules untouched.
- **Green command:** `npm run test -- firestore.rules.test.ts`
- **Commit message:** `feat(gam-v4): firestore rules deny client writes to v4 collections`
- **Rollback checkpoint:** Revert `firestore.rules`.
- **Acceptance criteria:** Emulator test proves client write is denied; server (admin) write allowed; wallet rules unchanged.

### Task 4.3 — Deterministic projection rebuild server function
- **Exact files:** `functions/src/gamification/v4/rebuildFunction.ts` (new), `functions/src/gamification/v4/rebuildFunction.test.ts` (new).
- **Functions/types introduced:** `rebuildProjection(familyId)` (reads ledger, reduces, writes state in one transaction).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- functions/src/gamification/v4/rebuildFunction.test.ts` fails.
- **Red command:** `npm run test -- functions/src/gamification/v4/rebuildFunction.test.ts`
- **Minimum implementation:** Server-only; uses Stage 1 reducer; writes `gamification_state` per member.
- **Green command:** `npm run test -- functions/src/gamification/v4/rebuildFunction.test.ts`
- **Commit message:** `feat(gam-v4): server projection rebuild function`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Rebuild equals full ledger replay (byte-identical business fields).

### Task 4.4 — Durable failure records
- **Exact files:** `functions/src/gamification/v4/failures.ts` (new), `functions/src/gamification/v4/failures.test.ts` (new).
- **Functions/types introduced:** `recordFailure(db, familyId, stage, reason, payload)`, `readFailures(familyId)`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- functions/src/gamification/v4/failures.test.ts` fails.
- **Red command:** `npm run test -- functions/src/gamification/v4/failures.test.ts`
- **Minimum implementation:** Append-only failure log; never throws away the offending record; wallet-abort path records reason.
- **Green command:** `npm run test -- functions/src/gamification/v4/failures.test.ts`
- **Commit message:** `feat(gam-v4): durable migration failure records`
- **Rollback checkpoint:** Delete the two files.
- **Acceptance criteria:** Failure record persisted; wallet-abort reason captured.

---

## 7. STAGE 5 — Write migration  ⛔ GATE 2 (before writing V4 production data)

Goal: write the approved replay result — deterministic events, one state per member, idempotent migration marker, no duplicate events, rebuild equality, wallet before/after hash equality. **Existing app still reads old system.**

### Task 5.1 — Write approved replay result
- **Exact files:** `scripts/migrate/write-v4-ledger.ts` (new), `scripts/migrate/write-v4-ledger.test.ts` (new).
- **Functions/types introduced:** `writeMigrationLedger(report)` (writes deterministic events + per-member state via server repository), `MIGRATION_BASELINE` events for each member.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- scripts/migrate/write-v4-ledger.test.ts` fails.
- **Red command:** `npm run test -- scripts/migrate/write-v4-ledger.test.ts`
- **Minimum implementation:** Consume Stage 3 approved report; write events (idempotent ids) + state; do NOT touch wallet.
- **Green command:** `npm run test -- scripts/migrate/write-v4-ledger.test.ts`
- **Commit message:** `feat(gam-v4): write approved replay result to v4 ledger+state`
- **Rollback checkpoint:** Delete new collections via backup (Stage 0.3); old system untouched.
- **Acceptance criteria:** V4 state equals full ledger replay; no duplicate events; old app unaffected.

### Task 5.2 — Idempotent migration marker + wallet hash equality  ⛔ GATE 2
- **Exact files:** `scripts/migrate/migration-marker.ts` (new), `scripts/migrate/migration-marker.test.ts` (new).
- **Functions/types introduced:** `writeMigrationMarker(familyId, reportHash)`, `verifyWalletHashesBeforeAfter()` (re-hash wallet docs, compare to Stage 0.4 snapshot; **fail non-zero on any diff**), `rerunIsNoOp()`.
- **Existing files modified:** none.
- **Failing test:** `npm run test -- scripts/migrate/migration-marker.test.ts` fails.
- **Red command:** `npm run test -- scripts/migrate/migration-marker.test.ts`
- **Minimum implementation:** Idempotent marker doc; wallet re-hash equality assertion; full rerun produces identical ledger (no-op).
- **Green command:** `npm run test -- scripts/migrate/migration-marker.test.ts`
- **Commit message:** `feat(gam-v4): idempotent migration marker + wallet hash equality`
- **Rollback checkpoint:** Delete marker + new collections; restore from backup.
- **Acceptance criteria:** **Mandatory tests #14 (wallet before/after byte-identical), #15 (full migration rerun is a no-op).** GATE 2 satisfied → proceed to Stage 6.

---

## 8. STAGE 6 — Verification before cutover  ⛔ GATE 2 exit

### Task 6.1 — Pre-cutover verification gate
- **Exact files:** `scripts/verify/pre-cutover.ts` (new), `scripts/verify/pre-cutover.test.ts` (new), `docs/gamification-v4/06-verification-report.md` (generated).
- **Functions/types introduced:** `verifyPreCutover(familyId): VerificationResult` (V4 state == full ledger replay; every member classified; no unexplained malformed/ambiguous; wallet hashes identical; no cross-family contamination; duplicate migration run is no-op).
- **Existing files modified:** none.
- **Failing test:** `npm run test -- scripts/verify/pre-cutover.test.ts` fails.
- **Red command:** `npm run test -- scripts/verify/pre-cutover.test.ts`
- **Minimum implementation:** Encode all six required checks; emit report; exit non-zero on any failure.
- **Green command:** `npm run test -- scripts/verify/pre-cutover.test.ts`
- **Commit message:** `feat(gam-v4): pre-cutover verification gate`
- **Rollback checkpoint:** No prod impact; re-run anytime.
- **Acceptance criteria:** All six checks green; report stored; **GATE 2 fully closed → eligible for Stage 7.**

---

## 9. STAGE 7 — Controlled writer cutover  ⛔ GATE 3 (before writer cutover)

Goal: switch one source at a time. Each action atomically: source action → deterministic V4 event → V4 projection. After each: emulator E2E, production-safe verification, duplicate test, rollback checkpoint. Old writer for that source disabled in the same release. **Never run old + new as simultaneous authoritative writers.**

### Task 7.1 — Cutover: task approval
- **Exact files:** `functions/src/gamification/v4/entrypoints/approveTaskCompletion.ts` (new), `src/lib/api.v4.tasks.ts` (new), `src/lib/api.v4.tasks.test.ts` (new).
- **Functions/types introduced:** `approveTaskCompletion(familyId, memberId, taskId, completionId, effectSnapshot?)`, client callable wrapper.
- **Existing files modified:** `src/lib/api.ts` (disable legacy task-approval RP/XP write for that source behind flag), `firestore.rules` (unchanged).
- **Failing test:** `npm run test -- src/lib/api.v4.tasks.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.tasks.test.ts`
- **Minimum implementation:** Server entry point builds deterministic event + folds state in one transaction; legacy writer gated off.
- **Green command:** `npm run test -- src/lib/api.v4.tasks.test.ts` + `npx playwright test --config playwright.config.ts -g "task approval"`
- **Commit message:** `feat(gam-v4): cutover task approval to v4 single writer`
- **Rollback checkpoint:** Flip flag back to legacy writer; V4 ledger frozen.
- **Acceptance criteria:** Emulator E2E passes; duplicate delivery no-op; legacy writer disabled in same release.

### Task 7.2 — Cutover: behaviour
- **Exact files:** `functions/src/gamification/v4/entrypoints/recordBehaviour.ts` (new), `src/lib/api.v4.behaviour.ts` (new), `src/lib/api.v4.behaviour.test.ts` (new).
- **Functions/types introduced:** `recordBehaviour(familyId, memberId, kind, points, reason)`.
- **Existing files modified:** `src/lib/behaviour.ts` (gate legacy writer), `src/lib/api.ts` behaviour path.
- **Failing test:** `npm run test -- src/lib/api.v4.behaviour.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.behaviour.test.ts`
- **Minimum implementation:** Positive/negative behaviour → deterministic event + fold; legacy path gated.
- **Green command:** `npm run test -- src/lib/api.v4.behaviour.test.ts`
- **Commit message:** `feat(gam-v4): cutover behaviour to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy; V4 frozen.
- **Acceptance criteria:** Negative behaviour −5 → RP −5 / XP unchanged (test #3); legacy disabled.

### Task 7.3 — Cutover: daily / perfect-day
- **Exact files:** `functions/src/gamification/v4/entrypoints/finalizeDailyGoals.ts` (new), `src/lib/api.v4.daily.ts` (new), `src/lib/api.v4.daily.test.ts` (new).
- **Functions/types introduced:** `finalizeDailyGoals(familyId, dayKey)` (scheduled/entry).
- **Existing files modified:** `src/domain/gamification/dailyProgress.ts` consumers (gate legacy daily XP writes).
- **Failing test:** `npm run test -- src/lib/api.v4.daily.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.daily.test.ts`
- **Minimum implementation:** Daily/perfect-day award → deterministic event + fold; legacy gated.
- **Green command:** `npm run test -- src/lib/api.v4.daily.test.ts`
- **Commit message:** `feat(gam-v4): cutover daily/perfect-day to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy.
- **Acceptance criteria:** Streak derived from V4 events only; legacy disabled.

### Task 7.4 — Cutover: reward redemption
- **Exact files:** `functions/src/gamification/v4/entrypoints/redeemReward.ts` (new), `src/lib/api.v4.rewards.ts` (new), `src/lib/api.v4.rewards.test.ts` (new).
- **Functions/types introduced:** `redeemReward(familyId, memberId, rewardId, cost)`.
- **Existing files modified:** `src/lib/api.ts` `redeemReward` (gate legacy `rewardPoints` write).
- **Failing test:** `npm run test -- src/lib/api.v4.rewards.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.rewards.test.ts`
- **Minimum implementation:** Redemption → deterministic event (RP −cost, XP unchanged) + fold; legacy gated.
- **Green command:** `npm run test -- src/lib/api.v4.rewards.test.ts`
- **Commit message:** `feat(gam-v4): cutover reward redemption to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy.
- **Acceptance criteria:** Test #4 (redeem −10 → RP −10 / XP unchanged); legacy disabled.

### Task 7.5 — Cutover: refund / reversal
- **Exact files:** `functions/src/gamification/v4/entrypoints/reverseEvent.ts` (new), `src/lib/api.v4.reversal.ts` (new), `src/lib/api.v4.reversal.test.ts` (new).
- **Functions/types introduced:** `reverseEvent(familyId, memberId, originalEventId)`.
- **Existing files modified:** `src/lib/reversalApi.ts` (gate legacy points reversal write).
- **Failing test:** `npm run test -- src/lib/api.v4.reversal.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.reversal.test.ts`
- **Minimum implementation:** Reversal → deterministic reversal event + fold; legacy gated.
- **Green command:** `npm run test -- src/lib/api.v4.reversal.test.ts`
- **Commit message:** `feat(gam-v4): cutover refund/reversal to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy.
- **Acceptance criteria:** Test #5 (reversal cancels exactly one original); legacy disabled.

### Task 7.6 — Cutover: avatar unlock
- **Exact files:** `functions/src/gamification/v4/entrypoints/unlockAvatar.ts` (new), `src/lib/api.v4.avatar.ts` (new), `src/lib/api.v4.avatar.test.ts` (new).
- **Functions/types introduced:** `unlockAvatar(familyId, memberId, avatarId)`.
- **Existing files modified:** `src/lib/api.ts` avatar unlock (~line 3089, gate legacy `rewardPoints` write).
- **Failing test:** `npm run test -- src/lib/api.v4.avatar.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.avatar.test.ts`
- **Minimum implementation:** Avatar unlock → deterministic event (RP −cost) + fold; legacy gated.
- **Green command:** `npm run test -- src/lib/api.v4.avatar.test.ts`
- **Commit message:** `feat(gam-v4): cutover avatar unlock to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy.
- **Acceptance criteria:** Avatar unlock deducts RP once; legacy disabled.

### Task 7.7 — Cutover: manual adjustment
- **Exact files:** `functions/src/gamification/v4/entrypoints/manualAdjustment.ts` (new), `src/lib/api.v4.manual.ts` (new), `src/lib/api.v4.manual.test.ts` (new).
- **Functions/types introduced:** `manualAdjustment(familyId, memberId, rpDelta, xpDelta, reason)`.
- **Existing files modified:** any legacy manual RP writer (gate).
- **Failing test:** `npm run test -- src/lib/api.v4.manual.test.ts` fails.
- **Red command:** `npm run test -- src/lib/api.v4.manual.test.ts`
- **Minimum implementation:** Manual adjustment → deterministic event + fold; legacy gated.
- **Green command:** `npm run test -- src/lib/api.v4.manual.test.ts`
- **Commit message:** `feat(gam-v4): cutover manual adjustment to v4 single writer`
- **Rollback checkpoint:** Flag back to legacy.
- **Acceptance criteria:** All 7 sources cut over; **GATE 3 satisfied → eligible for Stage 8.**

---

## 10. STAGE 8 — One UI read model  ⛔ GATE 4 (before UI cutover)

Goal: create one service/hook `resolveGamificationState(memberId)`. Migrate all screens. No UI arithmetic, no legacy fallback, no `users.lifetimeXP`, no direct `users.rewardPoints`, no separate Dashboard/Profile rules. All screens for a member render identical V4 state fields.

### Task 8.1 — `resolveGamificationState` read model
- **Exact files:** `src/lib/gamificationV4/resolveState.ts` (new), `src/lib/gamificationV4/resolveState.test.ts` (new), `src/lib/gamificationV4/useGamificationState.ts` (new hook).
- **Functions/types introduced:** `resolveGamificationState(familyId, memberId): GamificationStateV4 | null`, hook returning state or explicit "Gamification unavailable".
- **Existing files modified:** none (new module).
- **Failing test:** `npm run test -- src/lib/gamificationV4/resolveState.test.ts` fails.
- **Red command:** `npm run test -- src/lib/gamificationV4/resolveState.test.ts`
- **Minimum implementation:** Read `gamification_state/{memberId}`; return null when absent (never fabricate from legacy fields).
- **Green command:** `npm run test -- src/lib/gamificationV4/resolveState.test.ts`
- **Commit message:** `feat(gam-v4): single resolveGamificationState read model`
- **Rollback checkpoint:** Delete the three files; old resolvers untouched.
- **Acceptance criteria:** Returns V4 state; null → unavailable UI; no `lifetimeXP`/`rewardPoints` direct reads.

### Task 8.2 — Migrate Parent Dashboard
- **Exact files:** `src/pages/Dashboard.tsx` (modify), `src/pages/Dashboard.v4.test.tsx` (new).
- **Functions/types introduced:** consume `useGamificationState`.
- **Existing files modified:** `src/pages/Dashboard.tsx` (replace `currentUser.rewardPoints` read at ~line 115).
- **Failing test:** `npm run test -- src/pages/Dashboard.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/pages/Dashboard.v4.test.tsx`
- **Minimum implementation:** Render RP/level/progress from V4 state; no local arithmetic.
- **Green command:** `npm run test -- src/pages/Dashboard.v4.test.tsx`
- **Commit message:** `feat(gam-v4): dashboard reads v4 state`
- **Rollback checkpoint:** Revert Dashboard.tsx.
- **Acceptance criteria:** Dashboard values equal Profile values (test #9 anchor).

### Task 8.3 — Migrate Child Dashboard
- **Exact files:** `src/components/child/ChildDashboard.tsx` (modify if present) or child home, `src/components/child/ChildDashboard.v4.test.tsx` (new).
- **Functions/types introduced:** consume `useGamificationState`.
- **Existing files modified:** child dashboard component.
- **Failing test:** `npm run test -- src/components/child/ChildDashboard.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/components/child/ChildDashboard.v4.test.tsx`
- **Minimum implementation:** Same read model; no arithmetic.
- **Green command:** `npm run test -- src/components/child/ChildDashboard.v4.test.tsx`
- **Commit message:** `feat(gam-v4): child dashboard reads v4 state`
- **Rollback checkpoint:** Revert component.
- **Acceptance criteria:** Identical V4 fields as Parent Dashboard for same member.

### Task 8.4 — Migrate Children Overview (parent)
- **Exact files:** `src/components/parent/dashboard/ChildrenOverview.tsx` (modify), `src/components/parent/dashboard/ChildrenOverview.v4.test.tsx` (new).
- **Functions/types introduced:** consume `useGamificationState` per child.
- **Existing files modified:** `src/components/parent/dashboard/ChildrenOverview.tsx` (remove `lifetimeXP` fallback at ~line 107), `src/lib/gamificationAdapters.ts` (deprecate).
- **Failing test:** `npm run test -- src/components/parent/dashboard/ChildrenOverview.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/components/parent/dashboard/ChildrenOverview.v4.test.tsx`
- **Minimum implementation:** Use V4 state; remove legacy fallback; unavailable when state absent.
- **Green command:** `npm run test -- src/components/parent/dashboard/ChildrenOverview.v4.test.tsx`
- **Commit message:** `feat(gam-v4): children overview reads v4 state`
- **Rollback checkpoint:** Revert component + adapters.
- **Acceptance criteria:** No `lifetimeXP` fallback; unavailable state rendered when missing.

### Task 8.5 — Migrate Member Profile
- **Exact files:** `src/pages/MemberProfile.tsx` (modify), `src/pages/MemberProfile.v4.test.tsx` (new).
- **Functions/types introduced:** consume `useGamificationState`.
- **Existing files modified:** `src/pages/MemberProfile.tsx` (remove `member.rewardPoints` / `lifetimeXP` reads at ~lines 95, 136, 221).
- **Failing test:** `npm run test -- src/pages/MemberProfile.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/pages/MemberProfile.v4.test.tsx`
- **Minimum implementation:** Render from V4 state; no legacy fields.
- **Green command:** `npm run test -- src/pages/MemberProfile.v4.test.tsx`
- **Commit message:** `feat(gam-v4): member profile reads v4 state`
- **Rollback checkpoint:** Revert MemberProfile.tsx.
- **Acceptance criteria:** **Test #9 (Dashboard and Profile render identical values).**

### Task 8.6 — Migrate Rewards & Achievements
- **Exact files:** `src/pages/Rewards.tsx` (modify), `src/lib/achievements.ts` (modify to read V4 state), `src/pages/Rewards.v4.test.tsx` (new), `src/lib/achievements.v4.test.ts` (new).
- **Functions/types introduced:** Rewards reads V4 `rewardPoints`; achievements read V4 `xpTotal`/`unlockedAchievementIds`.
- **Existing files modified:** `src/pages/Rewards.tsx` (~lines 45, 148), `src/lib/achievements.ts`.
- **Failing test:** `npm run test -- src/pages/Rewards.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/pages/Rewards.v4.test.tsx`
- **Minimum implementation:** Rewards balance + achievements from V4 state; no `users.rewardPoints` direct read.
- **Green command:** `npm run test -- src/pages/Rewards.v4.test.tsx`
- **Commit message:** `feat(gam-v4): rewards and achievements read v4 state`
- **Rollback checkpoint:** Revert both files.
- **Acceptance criteria:** Rewards shows V4 spendable balance; achievements from V4 derivation.

### Task 8.7 — Migrate Leaderboard
- **Exact files:** `src/pages/Leaderboard.tsx` (modify or new), `src/pages/Leaderboard.v4.test.tsx` (new).
- **Functions/types introduced:** Leaderboard queries `gamification_state` collection; metric = defined V4 metric (xpTotal, with RP tie-break per design).
- **Existing files modified:** leaderboard component (remove `lifetimeXP`/task-completion aggregation).
- **Failing test:** `npm run test -- src/pages/Leaderboard.v4.test.tsx` fails.
- **Red command:** `npm run test -- src/pages/Leaderboard.v4.test.tsx`
- **Minimum implementation:** Single query over `gamification_state`; no UI arithmetic; no cross-family leakage.
- **Green command:** `npm run test -- src/pages/Leaderboard.v4.test.tsx`
- **Commit message:** `feat(gam-v4): leaderboard reads v4 state metric`
- **Rollback checkpoint:** Revert component.
- **Acceptance criteria:** **Test #10 (Leaderboard uses defined V4 metric).** GATE 4 satisfied.

---

## 11. STAGE 9 — Remove legacy system  ⛔ GATE 5 (before deleting legacy code)

Goal: only after live verification. Remove old gamification summaries, legacy client writers, compatibility lifetimeXP mirrors, V2/V3 shadow writers, migration gates, repair scripts, separate fallback resolvers, unused tests/documents. **Do not remove historical source records used for audit.**

### Task 9.1 — Remove legacy gamification summaries + client RP writes
- **Exact files:** `src/lib/gamificationAdapters.ts` (delete), `src/lib/api.ts` legacy RP/XP writes (remove), `src/domain/gamification/v3/` (delete after confirm).
- **Functions/types introduced:** none.
- **Existing files modified:** `src/lib/api.ts`, `src/lib/achievements.ts`, `src/components/parent/dashboard/ChildSummaryCard.tsx`.
- **Failing test:** `npm run test -- src/lib/gamificationAdapters.test.ts` fails (file deleted → confirms removal).
- **Red command:** `npm run lint && npm run typecheck`
- **Minimum implementation:** Delete adapters + legacy writers; ensure no remaining `lifetimeXP` gamification reads.
- **Green command:** `npm run lint && npm run typecheck && npm run test`
- **Commit message:** `refactor(gam-v4): remove legacy summaries and client rp writes`
- **Rollback checkpoint:** `git revert` tagged commit + Firestore export backup.
- **Acceptance criteria:** No `gamification_summaries` reads remain; no client `rewardPoints` writes.

### Task 9.2 — Remove compatibility lifetimeXP mirrors
- **Exact files:** `src/lib/gamificationProgression.ts` (delete), `src/lib/gamificationProgression.test.ts` (delete), `src/lib/api.ts` `lifetimeXP` writes (remove), user-creation `lifetimeXP: 0` (remove from gamification context only).
- **Functions/types introduced:** none.
- **Existing files modified:** `src/lib/api.ts`, `src/lib/googleRedirectAuth.ts`, `src/lib/bootstrapQueries.ts` (if referencing).
- **Failing test:** grep for `lifetimeXP` in gamification context returns zero (CI check).
- **Red command:** `node scripts/gamification-freeze-guard.cjs --check`
- **Minimum implementation:** Remove `lifetimeXP` gamification mirror; keep field inert if schema requires (no writes).
- **Green command:** `node scripts/gamification-freeze-guard.cjs --check`
- **Commit message:** `refactor(gam-v4): remove compatibility lifetimeXP mirrors`
- **Rollback checkpoint:** `git revert`.
- **Acceptance criteria:** No gamification code writes/reads `lifetimeXP`.

### Task 9.3 — Remove V2/V3 shadow writers + migration gates
- **Exact files:** `src/domain/gamification/v3/shadowCompare.ts` (delete), `src/domain/gamification/v3/storage.ts` (delete), migration gate flags in `src/lib/api.ts` (remove).
- **Functions/types introduced:** none.
- **Existing files modified:** `src/lib/api.ts` feature flags.
- **Failing test:** `npm run test` passes after deletion.
- **Red command:** `npm run test`
- **Minimum implementation:** Delete shadow writers + gates; confirm single writer path.
- **Green command:** `npm run test`
- **Commit message:** `refactor(gam-v4): remove v2/v3 shadow writers and migration gates`
- **Rollback checkpoint:** `git revert`.
- **Acceptance criteria:** No shadow writer remains; single V4 writer active.

### Task 9.4 — Remove dead repair scripts + separate fallback resolvers
- **Exact files:** `scripts/backfill-gamification-xp.ts` (delete), `scripts/bootstrap-v3-baseline.ts` (delete), `scripts/audit-gamification-projection.cjs` (delete if legacy-only), legacy fallback resolvers in `src/lib/gamificationAdapters.ts` (already deleted in 9.1).
- **Functions/types introduced:** none.
- **Existing files modified:** none new.
- **Failing test:** `npm run lint` passes.
- **Red command:** `npm run lint`
- **Minimum implementation:** Delete dead scripts; keep replay + wallet-snapshot + verification scripts (still useful).
- **Green command:** `npm run lint`
- **Commit message:** `refactor(gam-v4): remove dead repair scripts and fallback resolvers`
- **Rollback checkpoint:** `git revert`.
- **Acceptance criteria:** No orphaned legacy gamification scripts referenced by build.

### Task 9.5 — Remove unused tests/documents + final audit
- **Exact files:** legacy V3 test files (`src/domain/gamification/v3/*.test.ts`) (delete), `docs/gamification-v3/` (archive), keep `docs/gamification-v4/` + replay report.
- **Functions/types introduced:** none.
- **Existing files modified:** `package.json` test globs if needed.
- **Failing test:** full suite `npm run test` green.
- **Red command:** `npm run test`
- **Minimum implementation:** Delete V3 tests; archive old docs; run full audit (wallet hashes still identical, no cross-family).
- **Green command:** `npm run test && node scripts/wallet-snapshot.cjs --check`
- **Commit message:** `refactor(gam-v4): remove v3 tests and archive legacy docs`
- **Rollback checkpoint:** `git revert` + Firestore export.
- **Acceptance criteria:** Full suite green; wallet hashes unchanged; **GATE 5 closed.**

---

## 12. Mandatory tests → task map

| # | Test | Primary task(s) |
|---|---|---|
| 1 | Task +20 → RP +20 / XP +20 | 1.1, 1.9 |
| 2 | Positive behaviour +20 → RP +20 / XP +20 | 1.9 |
| 3 | Negative behaviour −5 → RP −5 / XP unchanged | 1.9, 7.2 |
| 4 | Redemption −10 → RP −10 / XP unchanged | 1.9, 7.4 |
| 5 | Reversal cancels exactly one original event | 1.8, 1.9, 7.5 |
| 6 | Duplicate delivery is a no-op | 1.2, 4.1 |
| 7 | Missing task snapshot uses current points + estimated=true | 2.2 |
| 8 | Projection deletion + ledger rebuild gives identical state | 1.10 |
| 9 | Dashboard and Profile render identical values | 8.2, 8.5 |
| 10 | Leaderboard uses defined V4 metric | 8.7 |
| 11 | Cross-family event rejected | 4.1 |
| 12 | Reward Points never negative | 1.3, 1.9 |
| 13 | XP only decreases through reversal | 1.3, 1.9 |
| 14 | Wallet before/after hashes byte-identical | 0.4, 5.2 |
| 15 | Full migration rerun is a no-op | 5.2 |

---

## 13. Approval gates (hard stops)

1. **GATE 1 — After production replay dry-run.** Stage 3.1 complete; owner approves `docs/gamification-v4/03-production-replay-report.md`. No Stage 4 until approved.
2. **GATE 2 — Before writing V4 production data.** Stage 5.2 wallet-hash equality + idempotent marker green. No Stage 6/7 until approved.
3. **GATE 3 — Before writer cutover.** All 7 legacy writers gated; Stage 7 entry blocked until approved.
4. **GATE 4 — Before UI cutover.** Stage 8 read model + all screens migrated and verified; blocked until approved.
5. **GATE 5 — Before deleting legacy code.** Live verification soak passed; Stage 9 entry blocked until approved.

No task may silently pass a gate — each gate has an explicit verification script + owner sign-off in the plan.

---

## 14. FINAL OUTPUT

- **Plan path:** `docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md`
- **Total task count:** 47 (Stage 0: 4, Stage 1: 10, Stage 2: 4, Stage 3: 1, Stage 4: 4, Stage 5: 2, Stage 6: 1, Stage 7: 7, Stage 8: 7, Stage 9: 5, plus gate verification tasks folded into stage tasks).
- **Stage/task breakdown:** see §1 and §3–§11.
- **Proposed files (new, representative):**
  - Domain: `src/domain/gamification/v4/{types,event,ids,validators,ordering,level,streak,achievements,reversal,reducer,rebuild}.ts` (+ `.test.ts` each)
  - Replay: `src/domain/gamification/v4/replay/{sources,classify,report}.ts`, `scripts/replay/{run-dry-run,production-report}.ts`
  - Storage/server: `functions/src/gamification/v4/{repository,rebuildFunction,failures}.ts`, `functions/src/gamification/v4/entrypoints/{approveTaskCompletion,recordBehaviour,finalizeDailyGoals,redeemReward,reverseEvent,unlockAvatar,manualAdjustment}.ts`
  - Migration/verify: `scripts/migrate/{write-v4-ledger,migration-marker}.ts`, `scripts/verify/pre-cutover.ts`, `scripts/{backup-gamification-collections,wallet-snapshot,gamification-freeze-guard}.cjs`
  - UI: `src/lib/gamificationV4/{resolveState,useGamificationState}.ts`, screen `.v4.test.tsx` for Dashboard/ChildDashboard/ChildrenOverview/MemberProfile/Rewards/Leaderboard.
- **Commit sequence:** stage0 (0.1→0.4) → stage1 (1.1→1.10) → stage2 (2.1→2.4) → stage3 (3.1, GATE1) → stage4 (4.1→4.4) → stage5 (5.1→5.2, GATE2) → stage6 (6.1) → stage7 (7.1→7.7, GATE3) → stage8 (8.1→8.7, GATE4) → stage9 (9.1→9.5, GATE5).
- **Test sequence:** every task red→green; full suite `npm run test` after each stage; emulator E2E per writer cutover; wallet-snapshot `--check` after Stages 5 and 9.
- **Approval gates:** 5 (see §13).
- **Estimated implementation size:** ~47 tasks; ~60 new files (≈30 prod + ≈30 test); net change dominated by deletions in Stage 9 (legacy V3 module ~12 files, adapters, dead scripts).
- **Estimated files replaced/removed:** replace ~10–14 (api.ts writers, Dashboard/Profile/ChildrenOverview/Rewards/Leaderboard consumers, firestore.rules, achievements.ts); remove ~6–10 (`gamificationAdapters.ts`, `gamificationProgression.ts`, `src/domain/gamification/v3/*`, `backfill-gamification-xp.ts`, `bootstrap-v3-baseline.ts`, shadow writers, legacy migration gates, dead repair scripts). Add ~5 (`v4` engine module, replay tool, wallet-snapshot, freeze-guard, verify scripts).
- **Exact first task:** **Task 0.1 — Extend the freeze inventory document.**
  - Files: `docs/gamification-v4/00-freeze-inventory.md` (new), `scripts/gamification-inventory.cjs` (extend TERMS).
  - Red: `node scripts/gamification-inventory.cjs --check`
  - Green: same command after regenerating inventory + authoring the freeze doc.
  - Commit: `docs(gam-v4): stage0 freeze inventory of gamification writers/readers`

---

*End of implementation plan. Awaiting execution approval. No code has been written.*
