/**
 * Gamification V4 — authoritative DAY FINALIZATION writer (Stage 7, Task 7.3).
 *
 * V4 side of the daily-goal / perfect-day cutover (legacy:
 * `functions/src/gamificationRepository.ts#finalizeChildDay`). Reached ONLY when
 * the Stage 7 route resolver returns `v4` for the `day_finalization` writer. Not
 * imported by `functions/src/index.ts`, so it can never become a deployed
 * production write path before activation (pinned by
 * `tools/architecture/v4-cutover-boundary.test.ts`).
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - At most TWO canonical events per finalised day: DAILY_GOAL_AWARDED and
 *     PERFECT_DAY_AWARDED. Each is a separate ledger fact so a perfect day can
 *     be replayed independently of the daily goal.
 *   - Deterministic event ids: `eventIdFor(familyId, memberId, eventType, dayKey)`
 *     — the day key IS the idempotency anchor, so finalising the same day twice
 *     (retry, scheduler re-run, replay) can never double-award.
 *   - No arithmetic: the award values and the "did the child qualify" decision
 *     are inputs, exactly as for the replay pipeline.
 *   - Duplicate delivery is a NO-OP; state is rebuilt by the canonical
 *     `rebuildStateFromLedger` (see `writerCore.applyEventV4`). The streak is
 *     therefore derived from the ledger, never incremented by this writer.
 *   - No legacy rewardPoints / lifetimeXP write, no wallet document.
 *
 * Emulator only: every exported async entry point asserts `assertEmulatorOnly`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  applyEventV4,
  assertSegmentV4,
  assertNonNegativeIntegerV4,
  WriterInputErrorV4,
  type WriterResultV4,
} from './writerCore'
import { assertEmulatorOnly } from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
} from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'

/** Thrown when the day-finalization facts handed to the V4 writer are unusable. */
export class DayFinalizationInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'DayFinalizationInputError'
  }
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** One award decided by the daily finalisation for a single day. */
export interface DayAwardV4 {
  /** Reward-points award (>= 0). */
  readonly rewardPoints: number
  /** XP award (>= 0). */
  readonly xp: number
}

/**
 * The already-validated facts of ONE finalised child-day.
 *
 * `dailyGoal` / `perfectDay` are present only when that award was earned; an
 * absent award writes NO event at all (an unqualified day is not a ledger fact).
 */
export interface DayFinalizationFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Local day key `YYYY-MM-DD` — the canonical idempotency anchor. */
  readonly dayKey: string
  readonly dailyGoal?: DayAwardV4
  readonly perfectDay?: DayAwardV4
  /** Business time of the finalisation (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** True only when fallback award values were used. */
  readonly estimated?: boolean
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

/** One result per event the finalisation produced (ordered goal, then perfect). */
export interface DayFinalizationWriteResultV4 {
  readonly dailyGoal: WriterResultV4 | null
  readonly perfectDay: WriterResultV4 | null
}

function assertDayKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !DAY_KEY_PATTERN.test(value)) {
    throw new DayFinalizationInputError('dayKey must be formatted YYYY-MM-DD')
  }
}

function assertAward(award: DayAwardV4, label: string): void {
  if (award === null || typeof award !== 'object') {
    throw new DayFinalizationInputError(`${label} must be an object`)
  }
  assertNonNegativeIntegerV4(award.rewardPoints, `${label}.rewardPoints`)
  assertNonNegativeIntegerV4(award.xp, `${label}.xp`)
}

/**
 * Build the ONE canonical DAILY_GOAL_AWARDED event for a finalised day.
 *
 * Pure and deterministic: identical facts always produce a byte-identical
 * event, including its id. Fails closed via `assertValidEventV4`.
 */
export function buildDailyGoalEventV4(facts: DayFinalizationFactsV4): GamificationEventV4 {
  return buildDayEventV4(facts, 'DAILY_GOAL_AWARDED')
}

/** Build the ONE canonical PERFECT_DAY_AWARDED event for a finalised day. */
export function buildPerfectDayEventV4(facts: DayFinalizationFactsV4): GamificationEventV4 {
  return buildDayEventV4(facts, 'PERFECT_DAY_AWARDED')
}

function buildDayEventV4(
  facts: DayFinalizationFactsV4,
  eventType: 'DAILY_GOAL_AWARDED' | 'PERFECT_DAY_AWARDED',
): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new DayFinalizationInputError('day finalization facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  assertDayKey(facts.dayKey)

  const isGoal = eventType === 'DAILY_GOAL_AWARDED'
  const award = isGoal ? facts.dailyGoal : facts.perfectDay
  if (award === undefined) {
    throw new DayFinalizationInputError(
      `${isGoal ? 'dailyGoal' : 'perfectDay'} award is absent: no event may be built`,
    )
  }
  assertAward(award, isGoal ? 'dailyGoal' : 'perfectDay')

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, eventType, facts.dayKey),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType,
    sourceType: isGoal ? SOURCE_TYPE.DAILY_GOAL : SOURCE_TYPE.PERFECT_DAY,
    sourceId: facts.dayKey,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: award.rewardPoints,
    xpDelta: award.xp,
    metadata: {
      dayKey: facts.dayKey,
      awardedPoints: award.rewardPoints,
    },
    estimated: facts.estimated === true,
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE finalised child-day through the V4 engine.
 *
 * Writes only the awards that were actually earned, each as its own canonical
 * event, through the shared Task 7.1 writer core. Re-finalising the same day is
 * a no-op for every already-written award.
 */
export async function applyDayFinalizationV4(
  db: Firestore,
  facts: DayFinalizationFactsV4,
): Promise<DayFinalizationWriteResultV4> {
  assertEmulatorOnly('applyDayFinalizationV4', { familyId: facts?.familyId })

  let dailyGoal: WriterResultV4 | null = null
  if (facts.dailyGoal !== undefined) {
    dailyGoal = await applyEventV4(db, buildDailyGoalEventV4(facts), { timezone: facts.timezone })
  }

  let perfectDay: WriterResultV4 | null = null
  if (facts.perfectDay !== undefined) {
    perfectDay = await applyEventV4(db, buildPerfectDayEventV4(facts), { timezone: facts.timezone })
  }

  return { dailyGoal, perfectDay }
}
