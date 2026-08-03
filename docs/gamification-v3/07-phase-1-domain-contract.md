# Phase 1 — V3 Domain Model and Shadow Contract

Status: implemented, behaviour-neutral for production.

Phase 1 adds a pure domain model only. No runtime flow, UI, legacy field,
production balance or deployment was changed. There is no V3 writer yet.

Source of truth: [`src/domain/gamification/v3/`](../../src/domain/gamification/v3).

| Module | Responsibility |
|---|---|
| [`event.ts`](../../src/domain/gamification/v3/event.ts) | Immutable event union and normative delta matrix |
| [`state.ts`](../../src/domain/gamification/v3/state.ts) | Canonical projection `GamificationStateV3` |
| [`ids.ts`](../../src/domain/gamification/v3/ids.ts) | Deterministic ledger identity |
| [`weeklyWindow.ts`](../../src/domain/gamification/v3/weeklyWindow.ts) | Timezone-aware day and week windows |
| [`validators.ts`](../../src/domain/gamification/v3/validators.ts) | Strict runtime validation |
| [`reducer.ts`](../../src/domain/gamification/v3/reducer.ts) | Pure deterministic fold |
| [`storage.ts`](../../src/domain/gamification/v3/storage.ts) | Shadow shapes and pure serialisers |
| [`shadowCompare.ts`](../../src/domain/gamification/v3/shadowCompare.ts) | Read-only comparison |

## 1. Final event union

`GamificationEventV3` is a discriminated union on `eventType`:

`TASK_APPROVED`, `BEHAVIOUR_POSITIVE`, `BEHAVIOUR_NEGATIVE`, `REWARD_REDEEMED`,
`AVATAR_UNLOCKED`, `MANUAL_ADJUSTMENT`, `REVERSAL`, `DAILY_GOAL_AWARDED`,
`PERFECT_DAY_AWARDED`, `LEGACY_BASELINE`, `WEEK_ROLLOVER`.

Every event carries: `schemaVersion` (3), `eventId`, `eventType`, `familyId`,
`memberId`, `sourceType`, `sourceId`, `effectiveAt`, `createdAt`,
`rewardPointsDelta`, `xpDelta`, `weeklyPointsDelta`, `idempotencyKey`,
`metadata`. Only `REVERSAL` carries `reversalOfEventId`; the type system forbids
it (`?: never`) on every other member, so the reference is not an optional field
but a property of the event type.

## 2. Delta matrix

`positive` = must be >= 0, `negative` = must be <= 0, `zero` = must be exactly 0,
`any` = either direction. Enforced by
[`DELTA_RULES_V3`](../../src/domain/gamification/v3/event.ts:131).

| Event type | rewardPointsDelta | xpDelta | weeklyPointsDelta |
|---|---|---|---|
| TASK_APPROVED | positive | positive | positive |
| BEHAVIOUR_POSITIVE | positive | positive | positive |
| BEHAVIOUR_NEGATIVE | negative | zero | zero |
| REWARD_REDEEMED | negative | zero | zero |
| AVATAR_UNLOCKED | negative | zero | zero |
| MANUAL_ADJUSTMENT | any | zero | zero |
| DAILY_GOAL_AWARDED | positive | positive | positive |
| PERFECT_DAY_AWARDED | positive | positive | positive |
| LEGACY_BASELINE | positive | positive | positive |
| WEEK_ROLLOVER | zero | zero | zero |
| REVERSAL | any | any | any (must mirror the referenced event) |

Normative consequences:

- Reward Points are spendable and may move in both directions, but the folded
  balance may never be negative.
- XP is lifetime progression. `REVERSAL` is the only event that can reduce it,
  and only by explicitly referencing the event being corrected.
- A redemption changes Reward Points and never XP or Weekly Points.
- A negative behaviour event reduces Reward Points only. It never reduces XP and
  never reduces Weekly Points, per the approved product contract.

## 3. Projection schema

`GamificationStateV3` groups fields deliberately:

- Identity: `memberId`, `familyId`.
- Ledger-derived: `rewardPoints`, `xpTotal`, `weeklyPoints`, `currentStreak`,
  `bestStreak`, `lastQualifiedDayKey`, `unlockedAvatarIds`.
- Deterministic derived: `weeklyWindowKey`, `level`, `xpProgressInLevel`,
  `xpToNextLevel`, `levelProgressPercentage`.
- Metadata: `projectionVersion`, `foldedThroughEventId`, `updatedAt`.

`xpTotal` is the single authoritative lifetime value. `lifetimeXP` does not
exist in V3; no field duplicates another under a second name.

Level fields are derived only through the canonical helper
[`levelProgressForXp`](../../src/domain/gamification/level.ts:26) with
`GAMIFICATION_CONFIG_V1.xpPerLevel`.

## 4. Ordering rules

Canonical ordering is `effectiveAt`, then `createdAt`, then `eventId`
lexicographically. The full sort is total and stable, so any storage order of
the same ledger folds to identical business fields. A reversal must sort after
the event it references; a reversal that sorts first is rejected.

## 5. Weekly semantics

- Timezone: the family's configured IANA timezone. Documented fallback is `UTC`
  when the family has no timezone or an unusable one. The browser timezone is
  never read.
- Day boundary: local midnight in that timezone.
- Week start day: Monday by default (`weekStartsOn = 1`, 0 = Sunday).
- Window key: `YYYY-Www`, derived from the ISO week-numbering year and week of
  the Thursday inside the local week.
- Current window: derived from the injected `context.asOf`, never from a clock
  inside the reducer.
- Rollover: `weeklyPoints` counts only events whose window equals the current
  window. Lifetime values (`rewardPoints`, `xpTotal`) are untouched by rollover.
  A `WEEK_ROLLOVER` event is a zero-delta marker, not a mutation.
- Delayed events: assigned by their `effectiveAt`, so a late write lands in the
  historical week it belongs to and no longer inflates the current week.
- Reversals: attributed to the weekly window of the **original** event, not the
  week the correction was entered.

Weekly Points and Reward Points are different metrics and are never forced to be
numerically equal: a member may hold 385 spendable Reward Points while the
weekly leaderboard correctly shows 5.

## 6. Reversal semantics

- `reversalOfEventId` is mandatory and must resolve to an event in the same fold.
- An event may be reversed at most once; a second reversal is an error.
- A reversal cancels exactly the referenced deltas, no more.
- A reversal of `AVATAR_UNLOCKED` also removes the unlocked avatar.
- There is no standalone untraceable correction; use `MANUAL_ADJUSTMENT` with an
  explicit `metadata.reason` when there is no prior event to reference.

## 7. Reducer invariants

`reduceGamificationEventsV3(events, context)`:

1. Validates every event and rejects duplicate identities.
2. Folds a single member of a single family only.
3. Sorts canonically before folding.
4. Never lets `rewardPoints` go below zero; an over-spend fails loudly rather
   than silently clamping. The single approved clamp is `MANUAL_ADJUSTMENT` with
   `metadata.clampToZero === true`.
5. Never lets `xpTotal` go below zero.
6. Applies each reversal exactly once.
7. Derives level fields via the canonical helper.
8. Contains no Firestore import, no Cloud Functions import, no `Date.now()`, no
   global state and no client-specific assumption. Time enters only through
   `context.asOf` and `context.weekly`.
9. Does not mutate its inputs.

## 8. Malformed-event policy

Malformed input throws `ValidationErrorV3`. It is never coerced, defaulted or
skipped. A member whose ledger cannot be validated has no projection rather than
an invented balance. The shadow comparison tool converts that failure into a
`malformed_data` classification instead of a silent difference.

## 9. Shadow collection contract

```
families/{familyId}/gamification_events_v3/{eventId}
families/{familyId}/gamification_state_v3/{memberId}
```

- Required event fields: as listed in section 1; `reversalOfEventId` only for
  reversals.
- Prohibited fields: `lifetimeXP`, `points`, `totalPoints`, `weeklyTotal`.
- Document id: the deterministic `eventId`, which makes a duplicate write a
  no-op overwrite of identical content rather than a double award.
- Index requirement: composite `memberId ASC, effectiveAt ASC` on
  `gamification_events_v3` for per-member ordered replay.
- Ownership: written only by the future Phase 2 shadow writer in Cloud
  Functions. Clients and tooling are read-only. No rules change is included in
  Phase 1 because nothing writes yet.
- Retention: events are immutable and retained indefinitely; state documents are
  disposable.
- Rebuild procedure: delete the state document, read the member's events ordered
  by `effectiveAt`, and fold them through `reduceGamificationEventsV3`. The
  result is byte-equivalent on the business fields.

## 10. Deterministic identity

| Source | Event id |
|---|---|
| Task approval | `task-approved:{familyId}:{memberId}:{logicalCompletionKey}` |
| Behaviour | `behaviour:{familyId}:{memberId}:{behaviourEventId}` |
| Redemption | `reward-redeemed:{familyId}:{memberId}:{redemptionId}` |
| Avatar unlock | `avatar-unlocked:{familyId}:{memberId}:{avatarId}` |
| Manual adjustment | `manual-adjustment:{familyId}:{memberId}:{adjustmentId}` |
| Daily goal | `daily-goal:{familyId}:{memberId}:{dayKey}` |
| Perfect day | `perfect-day:{familyId}:{memberId}:{dayKey}` |
| Legacy baseline | `legacy-baseline:{familyId}:{memberId}:v3` |
| Week rollover | `week-rollover:{familyId}:{memberId}:{weeklyWindowKey}` |
| Reversal | `reversal:{originalEventId}:{reversalId}` |

No random identifier is ever used for ledger identity.

## 11. Shadow comparison

`compareMemberShadow(input, context)` is pure and read-only. It accepts an
already-read legacy snapshot plus the available events and returns one of
`exact_match`, `reward_points_mismatch`, `xp_mismatch`,
`weekly_points_mismatch`, `streak_mismatch`, `insufficient_ledger_history`,
`malformed_data`.

When `ledgerComplete` is false the result is always
`insufficient_ledger_history` with no differences: an incomplete ledger can
never prove a mismatch.

## 12. Phase 1 exit evidence

- Domain suites: 58 tests across five V3 files, all passing.
- Historical regression scenarios encoded: legacy baseline 380 + positive
  behaviour 20 + shared task 20 gives `xpTotal` 420 with no duplicate award on
  replay; a new child with one 5-point task shows weekly 5, not 15.
- Architecture guard unchanged: 16 allowlist entries, 76 known violations, 0 new.
- No production runtime file was modified; no writer, no rules change, no deploy.

## 13. Recommended Phase 2 scope

Add the shadow writer only: emit V3 events from the existing task, behaviour,
redemption and reversal flows into `gamification_events_v3`, keep legacy writes
authoritative, run the comparison tool read-only over the shadow data, and do
not switch any read path until the classification report is clean.
