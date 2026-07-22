# Gamification Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-authoritative, immutable, rebuildable Phase 1 XP, levels, weighted daily progress, streaks, Perfect Day, summaries, and legacy XP migration.

**Architecture:** Pure rules live in `src/domain/gamification` and compile into Vite and the CommonJS Functions artifact from the same source. Firestore triggers and an hourly finalizer orchestrate Admin transactions that append deterministic events and replace only derived progress/summary projections. Client adapters render role-scoped caches and never calculate or write authoritative rewards.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, Zustand 5, Firebase Web SDK 12, Firebase Admin SDK, Firebase Functions v2 on Node 22, Firestore emulator, React Testing Library, i18next.

## Global Constraints

- Start from `todo-theme` at `279495ba477aeecda0f7d9a27c01167bcf52ddfe` with a clean tree.
- Scope is XP, levels, configurable Daily Goal percentage, weighted daily progress, streak, Perfect Day, immutable events, summaries, and baseline migration only.
- Do not add badges, Mystery Boxes, pets, Habit Tree, seasons, Family Boss, AI Coach, or push notifications.
- Task XP is its finite, non-negative, safe-integer `pointsReward` snapshot.
- Persisted manual and auto-approved completions use one logical occurrence identity and one server pipeline; arbitrary completion document IDs cannot duplicate rewards.
- For both approval modes, the client writes only completion state/reviewer metadata. One trusted trigger processor derives the authoritative occurrence/day, persists immutable effects, and atomically credits exact-once spendable `rewardPoints` with XP/bonus effects; no client writes task rewards, XP, or reservations.
- Config v1 is `xpPerLevel=1000`, Daily Goal default `80`, Daily Goal bonus `25`, Perfect Day bonus `50`.
- Only integer `dailyGoalPercentage` from 50 through 100 is family-configurable.
- At 100%, award both bonuses. Each positive bonus occurs once per child/local day.
- Zero eligible points awards nothing and is streak-neutral.
- Events are append-only. Reversals append compensation; `bestStreak` does not decrease.
- Immutable daily eligibility snapshots are authoritative denominators; progress, checkpoints, and summaries are rebuildable caches.
- Per-task daily contribution is capped to that task's frozen weight; never use a global total clamp.
- Cancellation/invalidation/reversal before or after award and cross-ID duplicate delivery must converge idempotently. An already-invalid source's atomic award/revoke causal group is observed only after its net-zero fold and cannot raise current/best streak.
- Domain modules have no React, Firebase/Firestore imports, browser globals, storage, or implicit clock.
- Client code is never authoritative for XP, level, streak, bonuses, progress, or summaries.
- Do not deploy or run a production migration.
- Stop before editing `firestore.rules` or `firestore.indexes.json`; obtain explicit user approval.
- Every task ends with relevant tests, root typecheck/build, affected Functions build/tests, `git diff --check`, specification review, and quality review.
- Do not mix pre-existing Playwright debt with Stage 2 regressions.
- Stop at Product Decision Gate A immediately before Task 8's schedule-to-eligibility adapter; Tasks 2-7 may implement the policy-neutral frozen-snapshot fold. Do not invent weekly/one-time, unassigned/shared, mid-day edit, or legacy duplicate-resolution policy.

---

## File map

- `src/domain/gamification/{config,types,xp,level,dailyProgress,streak,perfectDay,engine}.ts`: pure domain, logical identity, immutable eligibility contracts, and rebuild plans.
- `functions/src/gamification{Repository,Processor,Triggers,Scheduler,Repair}.ts`: trusted orchestration and bounded repair.
- `scripts/migrate-legacy-xp.ts`: idempotent dry-run/execute baseline migration.
- `src/lib/gamificationAdapters.ts`: cache-to-view adapter.
- `src/lib/bootstrapQueries.ts`, `src/store/useStore.ts`: role-scoped reads.
- `src/components/gamification/GamificationSummaryCard.tsx`: shared presentation.
- parent dashboard, child Dashboard, Member Profile, and Family Settings: integration.
- `firestore.rules` and its tests: explicit approval-gated security change.
- `firestore.indexes.json`: expected unchanged.

---

### Task 1: Commit architecture and implementation plan

**Files:**
- Create: `docs/superpowers/specs/2026-07-22-gamification-phase-1-design.md`
- Create: `docs/superpowers/plans/2026-07-22-gamification-phase-1.md`

**Interfaces:**
- Consumes: approved decisions and repository contracts at `279495b`.
- Produces: authoritative design and execution sequence.

- [ ] **Step 1: Verify preconditions**

```bash
test "$(git branch --show-current)" = "todo-theme"
test "$(git rev-parse HEAD)" = "279495ba477aeecda0f7d9a27c01167bcf52ddfe"
test -z "$(git status --porcelain)"
```

Expected: all commands exit 0 with no output.

- [ ] **Step 2: Self-review and commit only the documents**

```bash
rg -n "\b(T""BD|T""ODO)\b|implement[[:space:]]later|fill[[:space:]]in[[:space:]]details" docs/superpowers/{specs,plans}/2026-07-22-gamification-phase-1*.md
git diff --check
git add docs/superpowers/specs/2026-07-22-gamification-phase-1-design.md \
  docs/superpowers/plans/2026-07-22-gamification-phase-1.md
git commit -m "docs(gamification): plan phase 1 architecture"
```

Expected: `rg` exits 1 with no matches, diff check passes, and one commit contains exactly two docs.

- [ ] **Step 3: Mandatory review gate**

Send the commit to independent specification and document-quality reviewers. Amend findings and repeat until both return `PASS`.

### Task 2: Add versioned domain configuration and contracts

**Files:**
- Create: `src/domain/gamification/config.ts`
- Create: `src/domain/gamification/types.ts`
- Test: `src/domain/gamification/config.test.ts`
- Test: `src/domain/gamification/types.test.ts`

**Interfaces:**
- Consumes: no runtime dependency.
- Produces: `GAMIFICATION_CONFIG_V1`, `resolveGamificationConfig(input)`, `isValidXpReward(value)`, and `GamificationEventV1`, `TaskGamificationEffectV1`, `DailyEligibilitySnapshotV1`, `DailyProgressV1`, `GamificationSummaryV1`, `ScheduledTask`, `TaskCompletion`, `EngineTimestamp`.

- [ ] **Step 1: Write failing tests**

```ts
expect(GAMIFICATION_CONFIG_V1).toEqual({
  schemaVersion: 1, xpPerLevel: 1000, defaultDailyGoalPercentage: 80,
  dailyGoalBonusXp: 25, perfectDayBonusXp: 50,
});
expect(resolveGamificationConfig(undefined).dailyGoalPercentage).toBe(80);
expect(resolveGamificationConfig({ schemaVersion: 1, dailyGoalPercentage: 75 }).dailyGoalPercentage).toBe(75);
expect(() => resolveGamificationConfig({ schemaVersion: 1, dailyGoalPercentage: 49 })).toThrow();
expect(() => resolveGamificationConfig({ schemaVersion: 1, dailyGoalPercentage: 80.5 })).toThrow();
expect([isValidXpReward(0), isValidXpReward(25)]).toEqual([true, true]);
expect([isValidXpReward(-1), isValidXpReward(NaN), isValidXpReward(1.5)]).toEqual([false, false, false]);
```

- [ ] **Step 2: Prove RED**

Run: `npx vitest run src/domain/gamification/config.test.ts src/domain/gamification/types.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement exact readonly contracts and resolver**

Use design event/source unions and epoch-millisecond timestamps. Encode the minimum immutable completion effect, eligibility snapshot reference, migration state union, and rebuild checkpoint contracts. Return a frozen/read-only config. Do not import platform libraries.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/domain/gamification/{config,types}.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/domain/gamification
git commit -m "feat(gamification): add domain contracts and config"
```

Expected: all pass. Complete both reviews before Task 3.

### Task 3: Fold XP events and derive levels

**Files:**
- Create: `src/domain/gamification/xp.ts`
- Test: `src/domain/gamification/xp.test.ts`
- Create: `src/domain/gamification/level.ts`
- Test: `src/domain/gamification/level.test.ts`

**Interfaces:**
- Consumes: event/config types.
- Produces: `logicalCompletionKey`, `taskXpEventId`, `taskXpReversalEventId`, `legacyBaselineEventId`, `foldXpEvents`, `levelForXp`, `levelProgressForXp`.

- [ ] **Step 1: Write failing ID/fold/boundary tests**

```ts
expect(logicalCompletionKey('c', 'task', 'day:2026-07-22')).toBe(
  'task_v1|c|task|day:2026-07-22',
);
expect(taskXpEventId('task_v1|c|task|day:2026-07-22')).toBe(
  'task_xp:task_v1|c|task|day:2026-07-22',
);
expect(legacyBaselineEventId('f', 'c')).toBe('legacy_xp_baseline:f:c');
expect(levelForXp(999, 1000)).toBe(1);
expect(levelForXp(1000, 1000)).toBe(2);
expect(levelProgressForXp(1250, 1000)).toEqual({
  level: 2, xpIntoLevel: 250, xpToNextLevel: 750, percentage: 25,
});
```

Also test zero reward, slash/pipe component rejection, two completion document IDs producing one logical event, conflicting snapshots producing an integrity error rather than a winner, unordered folding, duplicate ID rejection, causal compensation, and negative-ledger rejection.

- [ ] **Step 2: Prove RED, implement, and prove GREEN**

Run RED: `npx vitest run src/domain/gamification/{xp,level}.test.ts`
Expected: missing modules/exports. Implement exact integer folds; never clamp corruption.

```bash
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/domain/gamification/xp.ts src/domain/gamification/xp.test.ts \
  src/domain/gamification/level.ts src/domain/gamification/level.test.ts
git commit -m "feat(gamification): fold xp events and derive levels"
```

Expected: all pass. Complete both reviews.

### Task 4: Calculate weighted progress over a frozen eligibility snapshot

**Files:**
- Create: `src/domain/gamification/dailyProgress.ts`
- Test: `src/domain/gamification/dailyProgress.test.ts`

**Interfaces:**
- Consumes: an already-authoritative `DailyEligibilitySnapshotV1`, frozen completion effects, immutable invalidation facts, family timezone/day.
- Produces: `familyDayKey`, `addFamilyDays`, `calculateDailyProgress`.

- [ ] **Step 1: Write failing time and frozen-weight tests**

Cover London winter/summer midnight and 2026 DST transitions, Istanbul/London differing day keys, zero denominator, invalid effects, manual/auto-approved parity, pending/rejected/cancelled/invalidated/reversed exclusion, cross-ID logical dedupe, conflicting-snapshot failure, and independent per-task caps.

```ts
expect(progressFor({ weights: [10, 30], approved: [30] })).toMatchObject({
  eligiblePoints: 40, approvedPoints: 30, progressPercentage: 75,
  dailyGoalReached: false, perfectDayReached: false,
});
expect(progressFor({ weights: [10, 30], approved: [10, 30] })).toMatchObject({
  approvedPoints: 40, dailyGoalReached: true, perfectDayReached: true,
});
expect(progressFor({ weights: [0], approved: [0] })).toMatchObject({
  eligiblePoints: 0, progressPercentage: 0,
  dailyGoalReached: false, perfectDayReached: false,
});
expect(progressFor({ weightsByTask: { a: 10, b: 30 }, effects: { a: 999, b: 30 } })).toMatchObject({
  eligiblePoints: 40, approvedPoints: 40,
}); // a contributes 10, not 999; no global clamp hides a per-task error.
```

- [ ] **Step 2: Prove RED, implement integer calculations, and commit**

Run RED: `npx vitest run src/domain/gamification/dailyProgress.test.ts`
Expected: missing module. Use explicit IANA timezone formatting, immutable snapshot weights, logical-key dedupe, independent per-task caps, and integer cross-multiplication. Schedule-to-snapshot policy belongs to the approved Firestore adapter, not this pure fold.

```bash
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/domain/gamification/dailyProgress.ts src/domain/gamification/dailyProgress.test.ts
git commit -m "feat(gamification): calculate weighted daily progress"
```

Expected: all pass. Complete both reviews.

### Task 5: Derive streak and threshold compensation

**Files:**
- Create: `src/domain/gamification/streak.ts`
- Test: `src/domain/gamification/streak.test.ts`
- Create: `src/domain/gamification/perfectDay.ts`
- Test: `src/domain/gamification/perfectDay.test.ts`

**Interfaces:**
- Consumes: immutable eligibility snapshots, invalidation-aware progress, and immutable threshold events.
- Produces: `calculateStreak`, `planThresholdEvents`, and deterministic daily event ID helpers.

- [ ] **Step 1: Write failing transition tests**

Test same-day idempotency, consecutive days, finalized miss reset, unfinalized current day, neutral zero-work bridge, late approval, reversal, and 100% planning `daily_goal_awarded:+25` plus `perfect_day_awarded:+50`. Replay causal groups ordered by `(effectiveAt, causalGroupId)`, apply their events by `(transitionRank, eventId)`, and observe streak state only after the complete group. Prove: (a) an already-invalid source's award+revoke in one group is net-zero and leaves current/best at 0 without transient qualification; (b) Monday award in group A records best 1, Monday revoke in later group B removes active qualification, and Tuesday award yields current 1 and best 1 rather than 2. Delete the summary cache and reproduce both results from immutable eligibility and award/revoke events.

- [ ] **Step 2: Prove RED, implement, verify, and commit**

Run RED: `npx vitest run src/domain/gamification/{streak,perfectDay}.test.ts`
Expected: missing modules. Positive IDs have no attempt counter; compensation references `causalEventId`; every transition has deterministic `causalGroupId`, `effectiveAt`, and `transitionRank`; same-day recovery cannot re-award XP. Cached `bestStreak` must not be its own authoritative input.

```bash
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/domain/gamification/streak.ts src/domain/gamification/streak.test.ts \
  src/domain/gamification/perfectDay.ts src/domain/gamification/perfectDay.test.ts
git commit -m "feat(gamification): derive streak and perfect day events"
```

Expected: all pass. Complete both reviews.

### Task 6: Compose the pure engine

**Files:**
- Create: `src/domain/gamification/engine.ts`
- Test: `src/domain/gamification/engine.test.ts`

**Interfaces:**
- Consumes: config, manual/auto-approved frozen effects, immutable eligibility, cancellation/invalidation/reversal facts, existing events/progress, processing epoch.
- Produces: `planApprovedTask(input): GamificationWritePlan`, `planTaskReversal(input): GamificationWritePlan`, `rebuildGamificationSummary(input): GamificationSummaryV1`.

- [ ] **Step 1: Write failing full-domain tests**

At 100%, assert manual and auto-approved inputs produce identical task/bonus events and summary total `task XP + 75`. Two document IDs with one logical key produce one award. Cancellation/invalidation/reversal after award produces exact compensation in a later causal group and preserves a legitimately achieved `bestStreak`. Reversal-before-award later converges to an immutable award+revocation pair in one atomic causal group with net zero; retries add nothing and replay never raises threshold qualification, `currentStreak`, `bestStreak`, or Perfect Day count. Shuffled events/eligibility/progress rebuild XP, level, current/best streak, and Perfect Day count without the old summary.

- [ ] **Step 2: Prove RED, implement plain-value plans, and commit**

Run RED: `npx vitest run src/domain/gamification/engine.test.ts`
Expected: missing module. Validate all sources and immutable effect fields before returning any planned write. Never emit a standalone negative event when the causal award is absent; the later approval/repair plan emits the pair atomically with one causal group and replay observes only the post-group state.

```bash
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/domain/gamification/engine.ts src/domain/gamification/engine.test.ts
git commit -m "feat(gamification): compose immutable event engine"
```

Expected: all pass. Complete both reviews.

### Task 7: Add idempotent legacy baseline migration

**Files:**
- Create: `scripts/migrate-legacy-xp.ts`
- Test: `scripts/migrate-legacy-xp.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Admin `Firestore`, optional family scope, execute flag, baseline ID helper, summary rebuild.
- Produces: `prepareGamificationMigration(db, familyId, cutoverAt)`, `migrateLegacyXp(db, args)`, baseline dry-run/execute CLI, and `npm run test:migration:gamification`.

- [ ] **Step 1: Write failing emulator tests**

Seed two families and test positive, zero, missing, invalid, valid pre-existing event, partial recovery, re-run, cross-family isolation, `schemaVersion`, `migratedAt`, and untouched original `lifetimeXP`. Test only `inactive -> prepared -> baseline_complete`, denied skipped/reverse transitions, required frozen `cutoverAt`, concurrent post-cutover event preservation during baseline summary rebuild, and that Task 7 neither defers/processes task rewards nor advances to `active`.

- [ ] **Step 2: Prove RED**

```bash
firebase emulators:exec --only firestore 'vitest run scripts/migrate-legacy-xp.test.ts'
```

Expected: FAIL because migration module is absent.

- [ ] **Step 3: Implement per-child transactions and commands**

Existing deterministic events are verified and skipped, never overwritten. Preparation uses compare-and-set from `inactive`; the baseline requires `prepared`, writes no task events, and transactionally appends the baseline plus a summary rebuilt from the baseline and any seeded/already-committed post-cutover events. Firestore conflicts retry against concurrent summary writes. It ends at `baseline_complete` only after every child is verified/skipped. Task 8 owns immediate live task processing, missed-trigger repair, backlog verification, and activation behavior. Add:

```json
"test:migration:gamification": "firebase emulators:exec --only firestore 'vitest run scripts/migrate-legacy-xp.test.ts'"
```

Exclude this emulator test from ordinary `npm test`, matching the goal migration pattern.

- [ ] **Step 4: Verify and commit**

```bash
npm run test:migration:gamification
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add scripts/migrate-legacy-xp.ts scripts/migrate-legacy-xp.test.ts package.json
git commit -m "feat(gamification): migrate legacy xp baselines"
```

Expected: all pass. Complete both reviews.

### Task 8: Add shared-source Functions orchestration

**Files:**
- Modify: `functions/tsconfig.json`
- Modify: `functions/package.json`
- Create after Product Decision Gate A: `functions/src/dailyEligibilityAdapter.ts`
- Test after Product Decision Gate A: `functions/src/dailyEligibilityAdapter.test.ts`
- Create: `functions/src/gamificationRepository.ts`
- Create: `functions/src/gamificationProcessor.ts`
- Test: `functions/src/gamificationProcessor.test.ts`
- Create: `functions/src/gamificationTriggers.ts`
- Test: `functions/src/gamificationTriggers.test.ts`
- Create: `functions/src/gamificationScheduler.ts`
- Test: `functions/src/gamificationScheduler.test.ts`
- Create: `functions/src/gamificationRepair.ts`
- Test: `functions/src/gamificationRepair.test.ts`
- Modify: `functions/src/index.ts`
- Test: `tests/functions/gamification.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: root pure engine, Admin Firestore, client-authored completion-state/reviewer transitions, authoritative task schedule/occurrence data, and reversal documents.
- Produces: approved `buildDailyEligibilitySnapshot`, `processApprovedCompletion`, `processTaskInvalidation`, `finalizeFamilyDay`, `repairGamificationPage`, `repairPostCutoverPage`, `onTaskCompletionWritten`, `onGamificationReversalCreated`, `finalizeGamificationDays`.

- [ ] **Step 1: Stop at Product Decision Gate A**

Report repository schedule fields and ask the user to decide weekly/one-time occurrence semantics, unassigned-task ownership, mid-day task edit/create/archive effects, and legacy conflicting-duplicate/reversal resolution. Record the answer in the design. Do not create `dailyEligibilityAdapter.ts` before approval.

- [ ] **Step 2: Write failing adapter, Functions, and emulator tests**

Use injected repository/clock dependencies. Emulator tests invoke processors against Admin Firestore and verify: manual/auto-approved identical trusted effects; auto-approved `awardedPoints`, timezone/day snapshot, and exact-once reward points; client task completion never directly mutates `rewardPoints`; every source at/after `cutoverAt` receives its complete reward/effect/event/projection transaction immediately while state is `prepared`; no reservation/effect can commit without rewardPoints/events/summary; trusted normalization of an arbitrary-ID pending completion created before cutover but approved after `prepared`; server-only occurrence-reservation cross-ID dedupe/conflict rejection; invalid reward no-write; cancellation/invalidation/reversal before and after award; later reversal preserving a legitimate best; already-invalid source award+revoke causal group leaving current/best/Perfect Day net-zero; late approval repair; cross-family rejection; immutable eligibility creation/content verification; zero-day finalization; 250-document generation/watermark paging; a write whose ID sorts before the cursor marking dirty and forcing restart; `<`/`>= cutoverAt` filtering; live/baseline concurrency; missed-trigger repair; checkpoint resume; and activation only after baseline plus repair verification.

Add an adversarial occurrence test with two arbitrary completion document IDs and two different syntactically valid client `periodKey` values that both refer to the same authoritative scheduled occurrence/local day. The processor must ignore those values as accounting authority, derive one normalized logical key from the schedule and validated completion time, reserve it once, and leave the second delivery with no additional `rewardPoints`, task XP, Daily Goal/Perfect Day events, feed item, or approved-task notification.

- [ ] **Step 3: Prove RED**

```bash
npm --prefix functions test -- src/dailyEligibilityAdapter.test.ts src/gamificationProcessor.test.ts \
  src/gamificationTriggers.test.ts src/gamificationScheduler.test.ts \
  src/gamificationRepair.test.ts
firebase emulators:exec --only firestore 'vitest run tests/functions/gamification.integration.test.ts'
```

Expected: missing modules/exports.

- [ ] **Step 4: Implement exact shared build and orchestration**

Set Functions `rootDir` to `..`, include Functions source and root gamification source, set `main` to `lib/functions/src/index.js`, and build `rm -rf lib && tsc`. Import root domain; do not copy it. Keep timestamps/Firestore types in adapters. Reuse `onTaskCompletionWritten`; do not add a callable or parallel task-award path. From `prepared` onward, the Admin transaction immediately derives authoritative occurrence/day data, verifies or creates the occurrence reservation and immutable effect, increments spendable `rewardPoints`, appends immutable gamification events, replaces progress/summary caches, and writes deterministic approved-task feed/notification IDs as one all-or-nothing unit. Never write an effect/reservation for later credit. Existing occurrence/event/effect identities must match exactly before reuse. Transactions are bounded to one logical occurrence/affected day. Repair pages at most 250 source documents within a generation's stable `watermarkAt`; it repairs only missed complete transactions, while every writer marks an in-flight generation dirty and dirty publish restarts. Validation errors have no fallback writes. Task 8 advances `baseline_complete -> active` only after the captured post-cutover repair boundary is drained and verified.

Add this root command and exclude the same emulator-backed file from the ordinary `test` script:

```json
"test:functions:gamification": "firebase emulators:exec --only firestore 'vitest run tests/functions/gamification.integration.test.ts'"
```

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix functions test
npm --prefix functions run build
npm run test:functions:gamification
npx vitest run src/domain/gamification/*.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add functions/src/gamificationRepository.ts functions/src/gamificationProcessor.ts \
  functions/src/dailyEligibilityAdapter.ts functions/src/dailyEligibilityAdapter.test.ts \
  functions/src/gamificationProcessor.test.ts functions/src/gamificationTriggers.ts \
  functions/src/gamificationTriggers.test.ts functions/src/gamificationScheduler.ts \
  functions/src/gamificationScheduler.test.ts functions/src/gamificationRepair.ts \
  functions/src/gamificationRepair.test.ts functions/src/index.ts functions/tsconfig.json \
  functions/package.json functions/lib package.json tests/functions/gamification.integration.test.ts
git commit -m "feat(gamification): process rewards in trusted functions"
```

Expected: all pass. Complete both reviews.

### Task 9: Approval-gated coherent Rules/client/settings cutover

**Files:**
- Modify only after explicit approval: `firestore.rules`
- Create only after explicit approval: `tests/firestore/gamification.rules.test.ts`
- Modify affected existing Rules tests: `tests/firestore/approvalCenter.rules.test.ts`, `tests/firestore/familySettings.rules.test.ts`, `tests/firestore/notifications.rules.test.ts`, `tests/firestore/behaviour.rules.test.ts`, `tests/firestore/reversal.rules.test.ts`
- Modify: `src/lib/api.ts`
- Modify client tests: `src/lib/api.tasks.test.ts`, `src/lib/api.approvals.test.ts`, `src/lib/api.behaviour.test.ts`, `src/lib/api.familySettings.test.ts`, `src/lib/notifications.api.test.ts`, `src/lib/api.transactionOrder.test.ts`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `src/i18n/locales/{en,tr}/settings.json`
- Expected unchanged: `firestore.indexes.json`

**Interfaces:**
- Consumes: final server paths/processors from Tasks 2-8, migration state, completion-state transition contract, and config resolver.
- Produces in one independently valid commit: role-scoped reads, server-only reward/effect writes, a client that writes only completion state, existing settings API support, and matching old/new Rules expectations.

- [ ] **Step 1: Stop before any production Rule/index edit**

Report the proposed combined Rules/client/settings diff, every new and affected existing Rules test, processor/migration results, query shapes, and confirmation that no composite index is expected. Request explicit approval. Do not edit `firestore.rules`, client cutover code, or affected Rules expectations until approval; they must land together rather than as incompatible sequential commits.

- [ ] **Step 2: After approval, write all failing Rules and client tests and prove RED together**

Rules coverage: parent/owner same-family reads; child own reads; cross-child/family denial; every client occurrence-reservation/eligibility/event/progress/checkpoint/summary write denied; direct XP/streak and task reward/effect writes denied; manual/auto clients limited to exact completion source/status/reviewer fields; arbitrary-ID legacy pending approval allowed without trusted fields; forged logical/period keys unable to grant rewards; legacy non-task XP accepted only in `inactive`; migration metadata client-write denied; owner-only validated config. Update the listed existing Rules suites for the same contract without weakening unrelated behavior.

Client coverage: the new client never writes task `rewardPoints`, legacy XP/streak fields, trusted effects, or occurrence reservations in any state; manual and auto paths write only completion state/reviewer fields; retries cannot manufacture credit; approved success feed/notifications are absent client-side while submission/rejection behavior remains; non-task spendable points preserve intended behavior without post-cutover compatibility XP; settings writes only `{gamification:{schemaVersion:1,dailyGoalPercentage}}` and rejects invalid percentages.

```bash
npm run test:rules
npx vitest run src/lib/api.tasks.test.ts src/lib/api.approvals.test.ts \
  src/lib/api.behaviour.test.ts src/lib/api.familySettings.test.ts \
  src/lib/notifications.api.test.ts src/lib/api.transactionOrder.test.ts \
  src/components/family/FamilySettings.test.tsx
```

Expected: new Rules and client assertions fail against the legacy contract.

- [ ] **Step 3: Implement the single coherent contract**

Add only approved Rule match/update constraints and do not broaden unrelated permissions. Keep the existing completion create/transition API and `onTaskCompletionWritten`; add no callable or parallel reward path. Manual and auto client writes contain only Rules-validated source/status/reviewer fields. Remove client task reward/reservation/effect/XP/streak and approved-success notification/feed writes. Preserve submission/rejection notifications and existing non-task spendable-point behavior. Reuse `updateFamilySettings`; add the labelled integer Daily Goal input (`min=50`, `max=100`) with help/error association, loading state, and EN/TR parity.

- [ ] **Step 4: Verify and commit Rules, client, settings, and affected tests together**

```bash
npm run test:rules
npx vitest run src/lib/api.tasks.test.ts src/lib/api.approvals.test.ts \
  src/lib/api.behaviour.test.ts src/lib/api.familySettings.test.ts \
  src/lib/notifications.api.test.ts src/lib/api.transactionOrder.test.ts \
  src/components/family/FamilySettings.test.tsx src/i18n/i18n.test.ts
npm run test:functions:gamification
npx tsc -b --pretty false
npm run build
git diff --check
git diff --exit-code -- firestore.indexes.json
git add firestore.rules tests/firestore/gamification.rules.test.ts \
  tests/firestore/approvalCenter.rules.test.ts tests/firestore/familySettings.rules.test.ts \
  tests/firestore/notifications.rules.test.ts tests/firestore/behaviour.rules.test.ts \
  tests/firestore/reversal.rules.test.ts src/lib/api.ts src/lib/api.tasks.test.ts \
  src/lib/api.approvals.test.ts src/lib/api.behaviour.test.ts \
  src/lib/api.familySettings.test.ts src/lib/notifications.api.test.ts \
  src/lib/api.transactionOrder.test.ts src/components/family/FamilySettings.tsx \
  src/components/family/FamilySettings.test.tsx src/i18n/locales/en/settings.json \
  src/i18n/locales/tr/settings.json
git commit -m "feat(gamification): cut over server-owned task rewards"
```

Expected: all new and existing Rules/client/Functions tests, typecheck, build, locale parity, and diff checks pass in this one commit; indexes remain byte-identical. Complete specification and security/quality reviews before continuing.

### Task 10: Add role-scoped adapters and subscriptions

**Files:**
- Create: `src/lib/gamificationAdapters.ts`
- Test: `src/lib/gamificationAdapters.test.ts`
- Modify: `src/lib/bootstrapQueries.ts`
- Modify: `src/store/useStore.ts`
- Modify tests: `tests/config/firestoreIndexes.test.ts`, `tests/store/useStore.test.ts`

**Interfaces:**
- Consumes: domain summary/progress and level projection.
- Produces: `adaptGamificationSummary(summary, progress): GamificationSummaryView`, `gamificationSummaries`, `dailyProgress` store resources.

- [ ] **Step 1: Write failing adapter/query/store tests**

Test level projection, progress mapping, unavailable summary, parent collection reads, child own-document reads, cleanup on sign-out/family switch, and no composite-index addition.

- [ ] **Step 2: Prove RED, implement, verify, and commit**

```bash
npx vitest run src/lib/gamificationAdapters.test.ts tests/config/firestoreIndexes.test.ts tests/store/useStore.test.ts
```

Expected before implementation: missing resources. Parents subscribe to family caches; children only own summary/current-day progress; nobody subscribes to events.

```bash
npx vitest run src/lib/gamificationAdapters.test.ts tests/config/firestoreIndexes.test.ts tests/store/useStore.test.ts
npm run test:rules
npx tsc -b --pretty false
npm run build
git diff --check
git diff --exit-code -- firestore.indexes.json
git add src/lib/gamificationAdapters.ts src/lib/gamificationAdapters.test.ts \
  src/lib/bootstrapQueries.ts src/store/useStore.ts \
  tests/config/firestoreIndexes.test.ts tests/store/useStore.test.ts
git commit -m "feat(gamification): load role-scoped summaries"
```

Expected: all pass and indexes unchanged. Complete both reviews.

### Task 11: Show parent summaries

**Files:**
- Modify: `src/components/parent/dashboard/ChildSummaryCard.tsx`
- Modify: `src/components/parent/dashboard/ChildSummaryCard.test.tsx`
- Modify: `src/components/parent/dashboard/ChildrenOverview.tsx`
- Modify: `src/components/parent/dashboard/ChildrenOverview.test.tsx`
- Modify: `src/components/parent/ParentDashboard.test.tsx`
- Modify: `src/i18n/locales/{en,tr}/dashboard.json`

**Interfaces:**
- Consumes: `GamificationSummaryView`.
- Produces: parent child cards displaying XP, level, weighted progress, streak, and Perfect Day without `lifetimeXP`.

- [ ] **Step 1: Write failing component tests**

Test multiple child-ID bindings, unavailable summary, 0/80/100% states, labelled semantic progress, Perfect Day copy, and no adult summary card.

- [ ] **Step 2: Prove RED, implement with existing tokens, and commit**

Run RED:

```bash
npx vitest run src/components/parent/dashboard/ChildSummaryCard.test.tsx \
  src/components/parent/dashboard/ChildrenOverview.test.tsx src/components/parent/ParentDashboard.test.tsx
```

Expected: cards still use legacy fields. Pass typed view models and add EN/TR keys together.

```bash
npx vitest run src/components/parent/dashboard/*.test.tsx \
  src/components/parent/ParentDashboard.test.tsx src/i18n/i18n.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/components/parent/dashboard/ChildSummaryCard.tsx \
  src/components/parent/dashboard/ChildSummaryCard.test.tsx \
  src/components/parent/dashboard/ChildrenOverview.tsx \
  src/components/parent/dashboard/ChildrenOverview.test.tsx \
  src/components/parent/ParentDashboard.test.tsx \
  src/i18n/locales/en/dashboard.json src/i18n/locales/tr/dashboard.json
git commit -m "feat(parent): show gamification summaries"
```

Expected: all pass. Complete both reviews.

### Task 12: Show child and profile summaries

**Files:**
- Create: `src/components/gamification/GamificationSummaryCard.tsx`
- Test: `src/components/gamification/GamificationSummaryCard.test.tsx`
- Modify: `src/pages/Dashboard.tsx`, `src/pages/Dashboard.test.tsx`
- Modify: `src/pages/MemberProfile.tsx`
- Create: `src/pages/MemberProfile.test.tsx`
- Modify: `src/i18n/locales/{en,tr}/{dashboard,profile}.json`

**Interfaces:**
- Consumes: current child/member `GamificationSummaryView`.
- Produces: weighted progress, XP/level, current/best streak, and Perfect Day presentation.

- [ ] **Step 1: Write failing UI tests**

Assert summary XP wins over conflicting `lifetimeXP`, exact level boundary/next XP, weighted points/target, semantic progress, streaks, Perfect Day state, and unavailable/loading state.

- [ ] **Step 2: Prove RED, implement, verify, and commit**

```bash
npx vitest run src/components/gamification/GamificationSummaryCard.test.tsx \
  src/pages/Dashboard.test.tsx src/pages/MemberProfile.test.tsx
```

Expected: missing component/legacy calculations. Use existing Card/Progress, plain view models, and no hardcoded visible strings.

```bash
npx vitest run src/components/gamification/GamificationSummaryCard.test.tsx \
  src/pages/Dashboard.test.tsx src/pages/MemberProfile.test.tsx src/i18n/i18n.test.ts
npx tsc -b --pretty false
npm run build
git diff --check
git add src/components/gamification/GamificationSummaryCard.tsx \
  src/components/gamification/GamificationSummaryCard.test.tsx \
  src/pages/Dashboard.tsx src/pages/Dashboard.test.tsx \
  src/pages/MemberProfile.tsx src/pages/MemberProfile.test.tsx \
  src/i18n/locales/en/dashboard.json src/i18n/locales/tr/dashboard.json \
  src/i18n/locales/en/profile.json src/i18n/locales/tr/profile.json
git commit -m "feat(child): show daily gamification progress"
```

Expected: all pass. Complete both reviews.

### Task 13: Final integration, accessibility, and operations

**Files:**
- Create: `docs/gamification-phase-1-operations.md`
- Create: `tests/components/gamificationPhase1.integration.test.tsx`
- Create: `tests/compat/gamificationPortabilityContract.test.ts`
- Create: `tsconfig.gamification-portability.json`
- Modify: `package.json`
- Do not modify: `firestore.indexes.json` without separate approval.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: full evidence, cutover/recovery instructions, clean branch.

- [ ] **Step 1: Add focused integration/accessibility coverage**

Test baseline-derived summary through adapters into parent/child 100% rendering. Add keyboard, label, error, and progress assertions. Add a no-DOM/no-Node `ES2021` + `ES2021.Intl` TypeScript project containing all domain files and portability fixtures for London DST/logical-key/progress behavior; expose it as `test:gamification:portability`. This is a static future-native portability check, not a real Expo/Hermes runtime claim, and must fail on React, DOM, browser, Firestore, or Node-only domain dependencies. A real Hermes smoke test remains contingent on a future Expo workspace. Do not alter old Playwright expectations unless Stage 2 caused the failure.

- [ ] **Step 2: Write operations documentation**

Document the exact `inactive -> prepared -> baseline_complete -> active` commands and guards, the single coherent client/Rules/settings cutover, maintenance-through-active policy, immediate complete post-cutover processing, cutover filters, dry-run/execute commands, missed-trigger repair/checkpoint resume, verification queries, partial recovery, deterministic reruns, compatibility fields, non-destructive rollback, and no-deploy status.

- [ ] **Step 3: Run complete verification**

```bash
git status --short
git diff --check
npx tsc -b --pretty false
npm test
npm --prefix functions test
npm --prefix functions run build
npm run test:functions:gamification
npm run test:migration:gamification
npm run test:rules
npm run test:gamification:portability
npm run build
npx vitest run src/i18n/i18n.test.ts
npm run test:e2e
```

Expected: zero Stage 2 unit, Functions, emulator, migration, rules, typecheck, build, locale, or diff-check failures. Classify Playwright against recorded Stage 1 debt; no new Stage 2 regression may remain. No deployment occurs.

- [ ] **Step 4: Commit verification artifacts**

```bash
git add docs/gamification-phase-1-operations.md \
  tests/components/gamificationPhase1.integration.test.tsx \
  tests/compat/gamificationPortabilityContract.test.ts \
  tsconfig.gamification-portability.json package.json
git commit -m "test(gamification): verify phase 1 integration"
```

Expected: only operations documentation and genuine Stage 2 test/fix files.

- [ ] **Step 5: Full review and clean-tree gate**

Request independent specification and security/quality review from `279495b` to `HEAD`. Fix findings in coherent commits and repeat. Re-run every command above, then require:

```bash
test -z "$(git status --porcelain)"
git diff --check
```

Expected: both reviews `PASS`, clean tree, no deployment/migration, and every production rule/index action explicitly approved and reported.
