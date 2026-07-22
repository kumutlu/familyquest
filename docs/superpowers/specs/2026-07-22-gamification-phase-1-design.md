# FamilyQuest Gamification Phase 1 Design

**Status:** Amended after the approved auto-approved-task decision and independent architecture review
**Date:** 2026-07-22
**Starting point:** `todo-theme` at `c210eaff639427d45f97f1d2a447975c4cbb7737`

## 1. Scope and fixed rules

Phase 1 adds XP, deterministic levels, a family-configurable Daily Goal percentage, weighted daily progress, current/best streaks, Perfect Day, immutable events, parent/child summaries, and a legacy XP baseline migration. It excludes badges, Mystery Boxes, pets, Habit Tree, seasons, Family Boss, AI Coach, and push notifications.

```ts
export const GAMIFICATION_CONFIG_V1 = {
  schemaVersion: 1,
  xpPerLevel: 1000,
  defaultDailyGoalPercentage: 80,
  dailyGoalBonusXp: 25,
  perfectDayBonusXp: 50,
} as const;
```

Only `dailyGoalPercentage` is configurable in Phase 1. It is an integer from 50 through 100 inclusive; missing settings resolve to 80. There is no UI for bonus values or `xpPerLevel`.

- Approved task XP equals the task's `pointsReward` snapshot.
- Valid rewards are finite, non-negative safe integers. Zero is valid and produces a zero-delta audit event. Invalid values produce no writes.
- Progress is weighted by eligible scheduled task points, not task count.
- Daily Goal awards 25 XP at the configured threshold; Perfect Day awards 50 XP at 100%; 100% awards both.
- A zero eligible-point denominator awards neither bonus and is neutral for streaks.
- Each positive daily bonus is created at most once per child per family-local day.
- Reversals append compensation events; events are never edited or deleted.
- `level = Math.floor(xpTotal / 1000) + 1`.
- Summary fields are rebuildable caches, never independent authority.
- `bestStreak` is a historical high and routine reversal/recalculation never reduces it.

Both persisted approval forms are first-class Phase 1 sources:

- manual: `pending_approval -> approved` after parent/owner review;
- auto-approved: a `requiresApproval === false` completion persisted directly with `status === 'approved'`.

They use the same logical identity, reward validation, frozen eligibility weight, event IDs, transaction processor, reversal rules, Daily Goal/Perfect Day rules, and summary rebuild. For both forms, the client only creates or transitions completion state. One trusted server processor validates the authoritative occurrence, credits spendable `rewardPoints`, and creates every gamification effect exactly once; no client task-completion transaction mutates `rewardPoints`.

## 2. Current architecture and compatibility boundary

The current client `src/lib/api.ts` directly updates `lifetimeXP` during task completion/approval, positive behaviour, challenge claim, and generic `awardPoints`. It also updates legacy streak fields from the browser clock. UI components independently derive levels from `lifetimeXP`. `reverseTransaction` creates immutable reversal records but intentionally has no XP effect. Current Firestore rules require task approval and positive-behaviour `lifetimeXP` mutations.

The accepted `c210eaf` Task Details regression fix gives current client completion documents deterministic child/task/period attempt IDs and preserves legacy random-ID and rejected-attempt compatibility. This is an interim client-workflow safeguard, not the Phase 1 accounting identity. Phase 1 still normalizes every arbitrary completion document ID—including IDs produced by `c210eaf`—to the server-derived `logicalCompletionKey` and server-only occurrence reservation. No gamification rule may trust a client completion document ID as proof of uniqueness or eligibility.

Phase 1 authority is limited to approved task rewards, Daily Goal and Perfect Day bonuses, their compensation events, and the one-time baseline. Positive behaviour, challenge claims, and generic point awards do not create Phase 1 XP events. Their spendable `rewardPoints` behavior remains, but their direct `lifetimeXP` writes are deprecated and are removed at the coordinated client/rule cutover. The baseline preserves all valid positive legacy XP accumulated before cutover, regardless of its original feature. No new reward source is invented.

`lifetimeXP`, `currentStreak`, and `longestStreak` remain temporary read-only compatibility fields. Migration does not delete or overwrite them. New UI reads server-owned summaries.

Because the existing rules require client XP writes, removing that authority and exposing new role-scoped reads requires a coordinated `firestore.rules` change. Implementation must stop and request explicit approval before editing production rules or indexes.

## 3. Pure shared domain

All business rules live here:

```text
src/domain/gamification/
  config.ts
  types.ts
  dailyProgress.ts
  xp.ts
  level.ts
  streak.ts
  perfectDay.ts
  engine.ts
```

These modules contain no React, Firebase/Firestore imports, browser globals, storage access, or implicit clock. Time, timezone, config, tasks, completions, reversals, events, and progress are explicit inputs. `Intl.DateTimeFormat` is the ECMAScript IANA-timezone primitive. A no-DOM/no-Node TypeScript portability check protects future React Native use, but is not described as a Hermes runtime test. A real Expo/Hermes smoke test is added when an Expo workspace/runtime exists. If that runtime lacks required IANA data, orchestration supplies precomputed local calendar parts through the same pure interface rather than adding browser logic.

The Functions package currently has `rootDir: "src"` and cannot import root `src/domain`. The exact single-source build strategy is:

- Functions import `../../src/domain/gamification/...`.
- `functions/tsconfig.json` sets `rootDir` to `..`, includes `functions/src/**/*.ts` and `../src/domain/gamification/**/*.ts`, and keeps CommonJS output under `functions/lib`.
- `functions/package.json` sets `main` to `lib/functions/src/index.js` and builds with `rm -rf lib && tsc`.
- Compiled Functions live in `functions/lib/functions/src`; the one compiled domain copy lives in `functions/lib/src/domain/gamification`.

Relative CommonJS imports remain resolvable and domain logic is not duplicated or published as an unnecessary package.

## 4. Trusted flow

```text
task completion written
  -> pending approval or existing auto-approved status
  -> completion becomes approved
  -> onTaskCompletionWritten Cloud Function
  -> Admin SDK transaction
  -> pure gamification engine
  -> occurrence reservation + frozen effect + exact rewardPoints credit
  -> immutable events + daily-progress projection + summary cache
  -> deterministic approved-task feed/notification record

task reversal written
  -> onReversalCreated Cloud Function
  -> Admin SDK transaction
  -> task XP compensation + threshold compensation(s)
  -> progress and summary rebuild
```

Auto-approved means the existing `requiresApproval === false` task completion is stored as `approved`; it does not mean the client writes rewards or XP. The client writes only completion-source and transition fields permitted by Rules. Parent-approved and auto-approved records converge on one processor. That processor derives and persists validated `awardedPoints`, server timestamp fields, timezone/day data, and the same immutable gamification effect snapshot for both forms, after validating family, child, authoritative task schedule/occurrence, status, reward, and timestamps.

Firestore triggers are at-least-once. Deterministic event IDs and idempotency keys turn retries into no-ops or deterministic cache repairs. A single Admin transaction reads all source/state documents, validates before planning, verifies any existing immutable identity, appends missing events, replaces projections, and commits all-or-nothing.

Completion triggers alone cannot distinguish a missed day from no assigned work. An hourly server scheduler therefore creates the authoritative immutable eligibility snapshot for a family-local day, finalizes yesterday's derived progress, and repairs bounded gaps. Completion/invalidation triggers recalculate affected projections immediately from the same frozen snapshot. The scheduler only orchestrates; eligibility, thresholds, and streaks remain pure.

## 5. Family-local days, logical identity, and eligibility

`familyDayKey(epochMilliseconds, timeZone)` returns Gregorian `YYYY-MM-DD` in a valid IANA family timezone. Missing/invalid legacy timezone resolves to `Europe/London`, matching current Family Settings. The same formatter provides local weekdays and DST-safe day navigation. Browser timezone and UTC truncation are never used.

The trusted processor derives the earning day from the authoritative occurrence schedule and validated `completedAt`, even if manual approval is later. Client-supplied `periodKey`, `dayKey`, timezone, reward, or effect fields are untrusted hints and cannot select a second occurrence. Both manual and auto-approved server effect snapshots persist the family timezone and derived day key. Changing timezone does not silently re-key history.

### Logical completion identity

An arbitrary `task_completions` document ID is not an accounting identity. The canonical logical occurrence key is built from the fields already used by recurrence:

```text
logicalCompletionKey = task_v1|{childId}|{taskId}|{periodKey}
```

The family is already scoped by its path. Security Rules validate child/task IDs against the existing Firebase-generated ID alphabet and validate recurrence `periodKey`; every component must be non-empty and contain neither `/` nor `|`. The `|` delimiter is therefore unambiguous and Rules can reproduce the key with string concatenation.

For each approved source, the trusted processor creates an immutable reservation at `families/{familyId}/task_occurrences/{logicalCompletionKey}` in the same Admin transaction that enriches the completion with its frozen effect, credits spendable reward points, appends gamification events, and replaces affected projections/caches. All clients are denied reservation create/update/delete and task-completion `rewardPoints` mutations. A second completion document ID—or a forged but syntactically valid alternate `periodKey` for the same authoritative occurrence/day—normalizes to the same reservation and cannot credit reward points, XP, or daily events again.

A pending completion created before cutover may retain its arbitrary document ID when approved after `prepared`. Its client approval transaction changes only the status/reviewer metadata. The server derives and creates the same deterministic occurrence reservation and frozen effect before rewarding it. Identical legacy duplicates converge. If conflicting sources arrive before an award, the occurrence is quarantined and awards nothing; a conflict discovered after an immutable award creates an integrity alert and no second write or mutation, pending explicit administrative resolution.

### Immutable task effect snapshot

Every approved completion, including auto-approved create, persists and then freezes:

```ts
interface TaskGamificationEffectV1 {
  schemaVersion: 1;
  familyId: string;
  childId: string;
  taskId: string;
  logicalCompletionKey: string;
  periodKey: string;
  dayKey: string;
  timezone: string;
  pointsReward: number;
  xpAward: number;
  rewardPointsAward: number;
  dailyWeight: number;
  requiresApproval: boolean;
  approvedAt: Timestamp;
}
```

The existing reversal `effectSnapshot` remains present for spendable-point reversal compatibility. The trusted processor writes `awardedPoints`, `effectSnapshot`, and `gamificationEffectSnapshot` on both approval paths and freezes them after persistence. Rules deny client writes to those trusted effect fields; the processor validates all reward fields against the authoritative task and each other.

### Authoritative daily eligibility snapshot

Daily eligibility/weight cannot be a mutable cache if historical streaks and `bestStreak` must be rebuildable. The scheduler creates exactly one server-owned immutable eligibility document for each child/local day before progress is evaluated. Progress references it and never reconstructs historical denominators from mutable task documents.

The current schema does not unambiguously answer all eligibility questions. Before implementing the schedule-to-snapshot adapter, execution stops at **Product Decision Gate A** and asks for explicit decisions on:

1. whether `weekly` and `one-time` tasks participate in a Daily Goal, and which local day represents an undated weekly occurrence;
2. whether a task with no `assigneeId` is eligible for every child, only the child who completes it, or nobody until assigned;
3. whether a task created, edited, assigned, unassigned, or archived after a day's snapshot changes that day or starts next day;
4. how legacy conflicting duplicate completion snapshots and reversals of only one duplicate source are administratively resolved.

No exclusion, shared-task ownership rule, historical schedule-edit rule, or duplicate winner rule is silently selected. The pure progress engine consumes a frozen `DailyEligibilitySnapshotV1`; the Firestore schedule adapter is implemented only after these decisions.

For each frozen eligible task weight, a valid approved logical completion contributes at most that task's frozen weight:

```text
taskContribution(taskId) = min(validCompletionDailyWeight, frozenTaskWeight(taskId))
approvedPoints = sum(taskContribution for unique logical task occurrences)
eligiblePoints = sum(frozen task weights)
progressPercentage = eligiblePoints == 0
  ? 0
  : floor(approvedPoints * 100 / eligiblePoints)

dailyGoalReached = eligiblePoints > 0
  && approvedPoints * 100 >= eligiblePoints * dailyGoalPercentage

perfectDayReached = eligiblePoints > 0
  && approvedPoints == eligiblePoints
```

There is no global post-sum clamp: every contribution is independently bounded by its authoritative frozen task weight. Manual and auto-approved completions use the same weight. Pending, rejected, cancelled, invalidated, and reversed logical occurrences contribute zero. Thresholds use integer cross-multiplication; display rounding never decides rewards. All-zero weights form a neutral zero denominator.

Reward validation and progress capping are separate and deterministic. The trusted processor accepts a task reward only when the authoritative task snapshot is a finite, non-negative safe integer; accepted `xpAward` and `rewardPointsAward` equal that snapshot exactly, while an invalid reward aborts the whole effect with no fallback write. There is no global reward clamp and no post-sum correction. For Daily Goal weighting only, each logical task contribution is independently capped with `min(validCompletionDailyWeight, frozenTaskWeight)` so one malformed or conflicting effect cannot consume another task's denominator.

## 6. Firestore model

### Family configuration

The existing family document gains one nested value through existing `updateFamilySettings`:

```ts
gamification: {
  schemaVersion: 1;
  dailyGoalPercentage: number;
}
```

Only the owner may write the validated object. Missing values resolve in memory to config defaults.

Trusted rollout tooling may separately write server-owned migration metadata, never through Family Settings:

```ts
gamificationMigration: {
  schemaVersion: 1;
  status: 'inactive' | 'prepared' | 'baseline_complete' | 'active';
  cutoverAt?: Timestamp;
  migratedAt?: Timestamp;
  repairCheckpoint?: string;
}
```

Only trusted tooling changes this state, with compare-and-set transitions `inactive -> prepared -> baseline_complete -> active`. Skipping, reversing, or overlapping states is rejected.

Migration metadata is stored on the family document and is therefore readable by existing family-document readers. It is server-write-only, not secret. Security Rules prevent every client from changing `gamificationMigration` while continuing to expose the state needed by the compatible client.

### Immutable logical occurrence reservation

Path: `families/{familyId}/task_occurrences/{logicalCompletionKey}`. It stores `familyId`, `childId`, `taskId`, authoritative `periodKey`, `completionId`, the frozen effect identity, and `createdAt`. Only the trusted processor may create it, once, in the all-or-nothing reward transaction; no client can create/update/delete it. It is the reservation that makes reward-point credit and gamification effects share one idempotency identity, not an XP balance or independent reward decision.

### Immutable event ledger

Path: `families/{familyId}/gamification_events/{eventId}`

```ts
interface GamificationEventV1 {
  schemaVersion: 1;
  familyId: string;
  childId: string;
  eventType:
    | 'xp_awarded'
    | 'xp_revoked'
    | 'daily_goal_awarded'
    | 'daily_goal_revoked'
    | 'daily_goal_qualification_changed'
    | 'perfect_day_awarded'
    | 'perfect_day_revoked'
    | 'perfect_day_qualification_changed'
    | 'legacy_xp_baseline';
  xpDelta: number;
  sourceType: 'task_completion' | 'daily_progress' | 'migration';
  sourceId: string;
  logicalCompletionKey?: string;
  idempotencyKey: string;
  dayKey?: string;
  timezone?: string;
  causalEventId?: string;
  causalGroupId: string;
  effectiveAt: Timestamp;
  transitionRank: number;
  taskId?: string;
  configSchemaVersion: 1;
  createdBy: 'gamification-engine-v1' | 'legacy-xp-migration-v1';
  createdAt: Timestamp;
  migratedAt?: Timestamp;
  sourceTransitionId?: string;
  qualificationState?: 'qualified' | 'unqualified';
}
```

The domain uses epoch milliseconds; Firestore adapters map them to timestamps. Deterministic document IDs equal idempotency keys:

```text
task_xp:{logicalCompletionKey}
task_xp_reversal:{logicalCompletionKey}
daily_goal:{familyId}:{childId}:{dayKey}
daily_goal_reversal:{familyId}:{childId}:{dayKey}
perfect_day:{familyId}:{childId}:{dayKey}
perfect_day_reversal:{familyId}:{childId}:{dayKey}
daily_goal_qualification:{familyId}:{childId}:{dayKey}:{sourceTransitionId}
perfect_day_qualification:{familyId}:{childId}:{dayKey}:{sourceTransitionId}
legacy_xp_baseline:{familyId}:{childId}
```

Pipes and colons are valid Firestore ID characters; the reserved delimiter is forbidden inside components. Cross-document duplicates therefore address the same event. `causalGroupId` is deterministic from the logical source transition; normal awards and later reversals use separate groups, while repair of a source already known invalid uses one shared atomic group for its award/revoke pair. `effectiveAt` is the authoritative source-transition time, not trigger-delivery time.

Bonus accounting and qualification history are deliberately separate. `daily_goal_awarded`/`perfect_day_awarded` grant XP once; their matching `*_revoked` compensation can remove that XP once and is never repeated. Every actual threshold state transition also appends a zero-XP `*_qualification_changed` event keyed by the authoritative transition source. Consequently award → revoke → same-day recovery appends `qualified`, `unqualified`, `qualified`; the recovery grants no second bonus but is visible to streak and Perfect Day replay. Further oscillations append deterministic zero-XP state transitions without editing earlier records. A retry of the same source transition addresses the same event and verifies identical content.

`sourceTransitionId` is canonical, server-derived, and never a trigger-delivery or repair-run ID:

```text
approval      = approval_v1|{logicalCompletionKey}
invalidation  = invalidation_v1|{immutableReversalId}
cancellation  = cancellation_v1|{completionId}|{authoritativeStatusChangedAtEpochMs}
finalization  = finalization_v1|{eligibilitySnapshotId}
```

Components use the logical-key delimiter validation rules and timestamps use canonical UTC epoch milliseconds. Manual and auto approval sources for one logical occurrence share the approval identity. Repair reconstructs the ID from the original authoritative fact. Each source can cause at most one state transition per threshold; repeated loss/recovery cycles require distinct authoritative facts and therefore distinct IDs. `causalGroupId` is `gamification_transition_v1|{sourceTransitionId}`, and `effectiveAt` is the authoritative approval, reversal, status-change, or local-day-finalization time. Fixed `transitionRank` values order writes inside the group. A group contains at most eight records; exceeding that bound is an integrity failure.

Finalization is itself an immutable replay fact. When a finalized day has `eligiblePoints > 0` but misses Daily Goal and/or Perfect Day, the scheduler appends the corresponding deterministic zero-XP `*_qualification_changed: unqualified` event using the finalization identity, even if the day was never previously qualified. An unfinalized day emits no finalization event, and a finalized zero-denominator day emits no qualification event and remains neutral. Late approval after finalization appends its later authoritative qualification transition. Replay never infers finalization from the current clock.

### Immutable daily eligibility ledger

Path/ID: `families/{familyId}/daily_eligibility/{childId}:{dayKey}`

```ts
interface DailyEligibilitySnapshotV1 {
  schemaVersion: 1;
  familyId: string;
  childId: string;
  dayKey: string;
  timezone: string;
  dailyGoalPercentage: number;
  taskWeights: Record<string, number>;
  eligibleTaskCount: number;
  eligiblePoints: number;
  effectiveAt: Timestamp;
  causalGroupId: string;
  transitionRank: 0;
  createdAt: Timestamp;
  createdBy: 'gamification-engine-v1';
}
```

The document is server-created once and cannot be updated or deleted. A retry must verify exact identity/content. It is the authoritative denominator and the historical neutral/missed-day source used to rebuild both streak fields.

### Daily progress projection

Path/ID: `families/{familyId}/daily_progress/{childId}:{dayKey}`

```ts
interface DailyProgressV1 {
  schemaVersion: 1;
  familyId: string;
  childId: string;
  dayKey: string;
  timezone: string;
  eligibilitySnapshotId: string;
  dailyGoalPercentage: number;
  eligiblePoints: number;
  approvedPoints: number;
  eligibleTaskCount: number;
  approvedTaskCount: number;
  progressPercentage: number;
  dailyGoalReached: boolean;
  perfectDayReached: boolean;
  finalized: boolean;
  contributingLogicalCompletionKeys: string[];
  invalidatedLogicalCompletionKeys: string[];
  calculatedAt: Timestamp;
}
```

This remains a replaceable server-derived projection. Its denominator comes only from the immutable eligibility snapshot; its numerator comes from frozen completion effects minus immutable reversal/invalidation facts. Clients cannot write it.

### Summary cache

Path: `families/{familyId}/gamification_summaries/{childId}`

```ts
interface GamificationSummaryV1 {
  schemaVersion: 1;
  familyId: string;
  childId: string;
  xpTotal: number;
  level: number;
  currentStreak: number;
  bestStreak: number;
  perfectDayCount: number;
  lastQualifiedDayKey: string | null;
  projectionRevision: number;
  foldedThrough: {
    effectiveAt: Timestamp;
    causalGroupId: string;
    transitionRank: number;
    documentId: string;
  } | null;
  rebuildRequired: boolean;
  earliestDirtyCursor: {
    effectiveAt: Timestamp;
    causalGroupId: string;
    transitionRank: number;
    documentId: string;
  } | null;
  projectionStatus: 'ready' | 'rebuilding';
  updatedAt: Timestamp;
}
```

`xpTotal` is the exact event-delta sum; a causally invalid negative ledger is rejected rather than clamped. Level is derived. Perfect Day count is the number of days whose latest immutable Perfect Day qualification transition is `qualified`; bonus XP remains the once-only award minus its at-most-once compensation. `currentStreak` rebuilds from immutable eligibility plus immutable qualification transitions, with current progress used only as a replaceable convenience projection.

`bestStreak` is rebuilt by chronologically replaying zero-XP `daily_goal_qualification_changed` transitions over immutable eligibility. Eligibility snapshots and events share the pageable semantic tuple `(effectiveAt, causalGroupId, transitionRank, documentId)`. Replay merges the two ordered collection streams by that tuple, groups adjacent records by `causalGroupId`, and observes qualification/streak only after the complete group. An ordinary later reversal has a distinct, later causal group, so a legitimately observed earlier maximum remains historical. Example: Monday qualification in group A records best 1; Monday unqualification in later group B removes Monday from active state; Tuesday qualification yields current 1 and best remains 1—not an invented streak of 2. A same-day recovery appends another qualification transition and can restore active streak state without granting XP twice. By contrast, a reversal already authoritative before an award causes the repair processor to append the award, compensation, and net-zero qualification transitions in one causal group; its post-group state is unqualified, so neither current nor best streak ever increases. The cached previous value is an optimization, not the sole source.

### Bounded live projection

No live transaction scans a child's full history. Each summary stores the exact projection fields declared above. `foldedThrough` advances only after a complete causal group is folded. An ordinary append whose semantic tuple follows that cursor applies a constant-size delta from the new immutable events plus the affected day's previous/new progress: XP delta, derived level, Perfect Day qualification delta, and the current-day streak transition. The transaction reads only direct identity documents, the affected eligibility/progress documents, the current summary, and adjacent finalized-day projection state. `projectionRevision` increments on every successful cache replacement; `projectionStatus` is `ready` only when `rebuildRequired === false` and `earliestDirtyCursor === null`.

If an approval, reversal, migration baseline, or repair is older than the summary cursor—or cannot update streaks from that bounded neighborhood—the same atomic write still appends authority and updates affected progress, but marks the summary `rebuildRequired` with the earliest dirty day/event cursor. It never publishes a guessed complete summary. UI treats a rebuilding summary as stale/unavailable. The paged generation below then recomputes the complete cache. Baseline migration likewise appends the baseline and marks/merges the dirty cursor; `baseline_complete` is forbidden until every affected child's bounded rebuild has published. This keeps authoritative writes bounded while ensuring every cache is eventually and deterministically complete.

### Bounded rebuild checkpoint

Path: `families/{familyId}/gamification_checkpoints/{childId}`. This server-only document is a discardable cursor/cache, never authority. A rebuild transaction creates a generation with `generationId`, `watermarkAt`, `dirty: false`, cursors, and partial fold state. Every authoritative event/eligibility writer reads the checkpoint in its transaction; if a generation is running it sets that generation `dirty: true`, causing a Firestore conflict/retry if initialization raced.

The generation freezes `watermarkAt` and maintains separate eligibility/event query cursors plus one pending causal group. Both collection streams filter `effectiveAt <= watermarkAt` and use the same semantic order `(effectiveAt, causalGroupId, transitionRank, documentId)`; each invocation reads at most 250 records total across the two streams, merges them in memory, and carries a causal group across page boundaries without observing it until its final record is read. A causal group is capped by contract at eight records; exceeding the cap is an integrity error rather than an unbounded read. At publish, a transaction verifies the same generation and `dirty === false`; only then does it replace the summary and exact `foldedThrough` cursor. If dirty, partial state is discarded and a new generation/watermark starts. Thus a late-created record with an earlier `effectiveAt` cannot be missed: every authoritative writer marks the generation dirty and the restarted generation includes it. Removing the checkpoint and replaying all stable pages produces the same summary. The two required semantic-order query shapes and any composite indexes are reported at the explicit index approval gate; no index file is edited beforehand.

## 7. Streak semantics

- A finalized eligible day reaching Daily Goal qualifies.
- A finalized eligible day missing the goal breaks current streak.
- A finalized zero-denominator day neither increments nor breaks; qualifying days on either side remain consecutive for streak purposes.
- An unfinalized current day below target does not break yesterday's streak.
- A qualifying current day may extend displayed current streak immediately.
- Same-day reprocessing recalculates the sequence and cannot double-increment.
- Late approval can restore historical qualification; reversal can remove it.
- `currentStreak` follows immutable eligibility and the latest qualification transition for each day.
- `bestStreak` comes from chronological qualification-transition replay and therefore preserves a legitimately reached historical maximum without joining days that were never simultaneously consecutive.

This implements “do not punish” without manufacturing credit on no-work days.

## 8. Transitions and compensation

Approval processing plans:

- one deterministic logical-occurrence reservation and one exact spendable `rewardPoints` credit;
- one frozen task effect plus deterministic approved-task feed/notification records;
- one `xp_awarded` event containing the exact task reward snapshot, including zero;
- replacement daily progress for the completion day;
- appended `daily_goal_awarded` and/or `perfect_day_awarded` events when newly reached;
- zero-XP `*_qualification_changed: qualified` events whenever a threshold becomes qualified, including same-day recovery without a second bonus;
- a bounded incremental summary update when its cursor permits it, otherwise an atomic `rebuildRequired` marker for paged reconciliation.

The repository commits the entire plan in one Admin transaction. It never exposes a credited reward balance without its reservation/effect/events, or events without the corresponding reward credit. Existing reservations/events must exactly match the plan; otherwise the transaction fails as an integrity error.

Invalidation includes an immutable task reversal record and any trusted transition of an approved source to `cancelled` or `invalidated`. Pending cancellation has no award to compensate. Invalidation processing reads the logical effect snapshot and plans:

- `xp_revoked` with the exact negative task XP and `causalEventId`;
- progress excluding the reversed completion;
- `daily_goal_revoked` and/or `perfect_day_revoked` when an awarded threshold is no longer reached;
- zero-XP `*_qualification_changed: unqualified` events whenever a threshold becomes unqualified;
- the same bounded summary update-or-dirty-marker rule used by approval processing.

No transition mutates historical awards. Existing deterministic events must match the planned immutable identity; a mismatch is a hard integrity error with no writes.

Ordering is not assumed. If reversal/invalidation is observed before `xp_awarded`, the invalidation processor records no negative event that would make the ledger invalid. When approval processing or the repair sweep later sees both facts, it atomically appends the deterministic award and its deterministic revocation (net zero) with the same `causalGroupId` and `effectiveAt`, ordered internally by `transitionRank`, and leaves the occurrence excluded from progress. Threshold award/revoke pairs caused by the same already-invalid source use that same atomic-group rule. Replay folds the complete group before observing streak or Perfect Day qualification, so no transient qualification, bonus count, `currentStreak`, or `bestStreak` increase is exposed. If the award exists first, invalidation appends the missing revocation in a distinct later causal group; this removes current qualification while preserving a best streak that was legitimately achieved before invalidation. Repeated and cross-ID deliveries converge on the same immutable pair.

## 9. Legacy baseline migration

For each child with finite, positive, safe-integer `lifetimeXP`, create exactly one event:

```ts
{
  schemaVersion: 1,
  eventType: 'legacy_xp_baseline',
  xpDelta: existingLifetimeXP,
  sourceType: 'migration',
  sourceId: 'legacy_lifetime_xp',
  idempotencyKey: `legacy_xp_baseline:${familyId}:${childId}`,
  causalGroupId: `legacy_xp_baseline:${familyId}:${childId}`,
  effectiveAt: familyCutoverAt,
  transitionRank: 0,
  configSchemaVersion: 1,
  createdBy: 'legacy-xp-migration-v1',
  createdAt: migrationRunAt,
  migratedAt: migrationRunAt,
}
```

`familyCutoverAt` is the already-frozen concrete Admin `Timestamp` from `gamificationMigration.cutoverAt`, so the baseline sorts deterministically before or alongside the first post-cutover facts and its exact semantic cursor is available before the transaction. `migrationRunAt` is one concrete Admin `Timestamp` captured before the first write transaction and reused for `createdAt`/`migratedAt`; it is never a server transform. On rerun, an existing event must match every semantic/accounting field, while the original operational `createdAt`/`migratedAt` values are preserved and intentionally excluded from equality against the new run clock.

Missing, invalid, zero, and negative values create no baseline. One transaction per child verifies an existing deterministic event instead of overwriting it and merges the baseline's fully known semantic position into the summary's earliest dirty cursor. It does not scan or rebuild history. Re-runs are no-ops; partial runs resume per child; family paths and user `familyId` are cross-checked. The user field remains untouched.

The cutover state machine separates pre-cutover baseline XP from live post-cutover rewards without deferring valid credits:

1. `inactive`: existing clients/rules remain authoritative for legacy `lifetimeXP`; installed Functions observe but create no gamification data.
2. `prepared`: trusted tooling atomically records `cutoverAt`; the already-deployed coordinated client/Rules contract changes from its `inactive` completion-write barrier to permitting completion-state writes while continuing to deny legacy client reward/XP writes. For every approved source with `approvedAt >= cutoverAt`, the trusted processor immediately commits the complete Admin transaction: occurrence reservation, frozen effect, spendable `rewardPoints`, XP/bonus events, daily progress, bounded summary update or dirty marker, and deterministic success records. It never persists a reversible effect or reservation while deferring the corresponding credit. Trigger retries and repair use the same deterministic identities.
3. baseline pass: while post-cutover sources continue through complete live transactions, migration appends each frozen pre-cutover `legacy_xp_baseline` and transactionally merges the affected summary's earliest dirty cursor. The baseline and live writers conflict/retry safely on bounded projection state; neither overwrites immutable events. The paged rebuilder publishes complete summaries before `baseline_complete`; UI remains migration-gated.
4. `baseline_complete`: all children have been verified/skipped, every baseline-dirtied summary has a clean published rebuild, and trusted orchestration advances the state atomically. Live complete processing never pauses. Backfill is repair for a missed trigger only, never the normal credit path.
5. `active`: a final repair checkpoint proves no post-cutover source is missing its reservation/credit/events and the state advances. A source before `cutoverAt` is always filtered out; a source at exactly `cutoverAt` is post-cutover. Normal triggers and bounded repair continue.

No state transition may skip forward or move backward. The coordinated Rules contract enforces a completion create/approval write barrier while migration state is `inactive`; therefore neither old clients, mobile clients, nor direct SDK writes can create the pre-`cutoverAt` lost-award window after legacy reward writes are denied. The trusted `inactive -> prepared` transition atomically establishes `cutoverAt`; Rules then permit state-only completion writes and the server processes the inclusive `approvedAt >= cutoverAt` range. Old clients that attempt legacy reward/XP writes remain denied. Operational maintenance/readiness begins before the coherent client/Rules cutover and remains through baseline verification, post-cutover repair/backlog verification, and transition to `active`; only then is normal UI enabled. This repository work performs no production state transition, migration, or deployment.

Emulator tests cover positive, zero, missing, invalid, re-run, partial recovery, valid pre-existing event, original field preservation, cross-family isolation, every legal/illegal state transition, exact cutover boundary filtering, complete live processing during `prepared`, concurrent baseline/live summary retry, missed-trigger repair, no effect-without-credit intermediate state, and checkpoint resume.

## 10. Client reads and UI

After the rules gate:

- parent/owner subscribes to all family summaries and current progress;
- child reads only `gamification_summaries/{uid}` and `daily_progress/{uid}:{today}`;
- no Phase 1 UI subscribes to the full event ledger.

A pure adapter returns XP total, level progress, XP to next level, current/best streak, Perfect Day count, and weighted daily progress. Child Dashboard and Member Profile replace legacy field calculations. Parent child cards show XP/level, progress, streak, and Perfect Day. Missing summaries display an unavailable/migration-safe state, not a false zero.

Family Settings reuses `updateFamilySettings` and adds one accessible integer Daily Goal control. It does not create a second API/callable/write path. English and Turkish keys are added together with exact parity.

The coordinated task API/rule change supports both approval modes, but the client only creates or transitions task completion state. Task 8 creates and exports one new Firestore completion trigger over the existing completion collection/workflow—not a callable or parallel award path—and that trigger runs the trusted processor. Its Admin transaction derives the authoritative logical occurrence/day, reserves it, freezes effect snapshots, credits the exact validated spendable reward points, appends XP/bonus/qualification events, and updates projections atomically. It also creates deterministic approved-task feed/notification records; client approval code does not emit those success records, preventing retry duplicates. Rejected/submitted notifications remain in their existing appropriate transition paths. Tests prove reward-point parity, cross-document logical dedupe, and no client reward authority for both approval forms.

## 11. Security and index gate

Required rule behavior, only after explicit approval:

- parents/owners read all same-family summaries/progress;
- child reads only own summary/progress;
- cross-family/cross-child reads are denied;
- all clients, including owner, are denied event/progress/summary create, update, and delete;
- no client directly alters XP, streaks, bonuses, or summary caches;
- no client, including parent/owner, may change `rewardPoints` as part of task completion/approval or create an occurrence reservation/effect snapshot;
- legacy behaviour/challenge/generic flows may not change `lifetimeXP` after cutover;
- only owner updates validated nested gamification config.

Admin Functions/migrations bypass client rules and are the only writers of occurrence reservations, trusted task effects, task reward-point credits, eligibility, events, progress, checkpoints, and summaries. The client/Rules/server cutover is one reviewed task and one independently valid commit after explicit Rules approval: old task-reward client writes exist only before that contract; the new Rules deny all client task reward/effect/reservation mutations in every state, deny completion create/approval while `inactive`, and allow only state transitions from `prepared` onward; the compatible client never writes task rewards; and the trusted processor immediately performs the complete post-cutover transaction from `prepared` onward. Maintenance/readiness spans the coherent cutover through `active`, so no incompatible client or partially migrated summary is exposed. No layer is committed with imports or writes that require a later fix-up commit. Proposed reads are direct documents or family subcollections. If bounded repair query evidence requires a composite index, stop before editing `firestore.indexes.json` and request approval.

## 12. Verification and rollout

Domain tests cover config, reward validation, logical IDs, cross-ID duplicates, event folding, levels, per-task capped weighted progress, zero denominator, approved/cancelled/invalidated/reversed states, simultaneous bonuses, compensation, out-of-order reversal, streak reset/neutrality/recovery, event-derived best preservation, and paged full rebuild.

Functions/emulator tests cover manually and auto-approved effect snapshots, reward-point parity, invalid source no-write, cross-ID duplicate delivery, atomic writes, reversal/cancellation/invalidation before and after award, repair sweep, cross-family isolation, eligibility initialization, finalization, checkpoint paging, and every migration state/cutover case. One adversarial test submits syntactically valid but different client `periodKey` values for the same authoritative scheduled occurrence/day and proves the server creates one reservation, one reward-point credit, and one set of XP/threshold events. Replay tests prove an already-invalid source's same-causal-group award/revoke pair is net-zero without transient `currentStreak` or `bestStreak`, while a genuine later reversal preserves the earlier historical best. Client and Rules tests prove no client can mutate task rewards/effects/reservations, plus adapters, role-scoped queries, settings, parent/child rendering, accessibility, EN/TR parity, and a static no-DOM/no-Node portability compile for future native reuse.

Every commit passes focused tests, root typecheck/build, affected Functions build/tests, and `git diff --check`, then receives specification and quality review. Implementation stops before production rule/index changes for explicit approval.

The eventual release order is: deploy state-aware dormant Functions; enter maintenance/readiness mode; deploy the single coherent client/Rules/settings cutover commit, which denies legacy task reward writes and enforces the `inactive` completion create/approval barrier; verify both the barrier and compatible client/processor; atomically transition `inactive -> prepared` to record `cutoverAt`, which opens state-only completion writes; immediately smoke-test a complete server-processed post-cutover reward transaction; run/review/execute baselines while all new approvals continue to receive complete server transactions; finish every baseline-triggered bounded summary rebuild; transition to `baseline_complete`; run/resume bounded missed-trigger repair until its checkpoint is caught up; transition to `active`; then leave maintenance and enable summary UI. There is no permitted completion write between legacy-authority removal and `cutoverAt`, and no deferred post-cutover credit window. Rollback before `active` remains in maintenance but never moves stored state backward or deletes events. After activation, rollback disables trigger/read surfaces while preserving events, snapshots, checkpoints, and compatibility fields. This task does not deploy.
