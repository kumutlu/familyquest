import { describe, expect, it } from 'vitest'
import type { GamificationEventV1 } from './types'
import {
  foldXpEvents,
  legacyBaselineEventId,
  logicalCompletionKey,
  taskXpEventId,
  taskXpReversalEventId,
} from './xp'

const logicalKey = 'task_v1|child-1|task-1|day:2026-07-22'

function event(overrides: Partial<GamificationEventV1> = {}): GamificationEventV1 {
  return {
    schemaVersion: 1,
    familyId: 'family-1',
    childId: 'child-1',
    eventType: 'xp_awarded',
    xpDelta: 25,
    sourceType: 'task_completion',
    sourceId: 'completion-1',
    logicalCompletionKey: logicalKey,
    idempotencyKey: taskXpEventId(logicalKey),
    causalGroupId: 'gamification_transition_v1|approval_v1|task_v1|child-1|task-1|day:2026-07-22',
    effectiveAt: 1_753_139_200_000,
    transitionRank: 0,
    configSchemaVersion: 1,
    createdBy: 'gamification-engine-v1',
    createdAt: 1_753_139_200_000,
    ...overrides,
  }
}

describe('XP event identities', () => {
  it('builds canonical task and baseline identities', () => {
    expect(logicalCompletionKey('c', 'task', 'day:2026-07-22')).toBe('task_v1|c|task|day:2026-07-22')
    expect(taskXpEventId('task_v1|c|task|day:2026-07-22')).toBe('task_xp:task_v1|c|task|day:2026-07-22')
    expect(taskXpReversalEventId('task_v1|c|task|day:2026-07-22')).toBe(
      'task_xp_reversal:task_v1|c|task|day:2026-07-22',
    )
    expect(legacyBaselineEventId('f', 'c')).toBe('legacy_xp_baseline:f:c')
  })

  it('keeps colon-containing baseline components injective', () => {
    expect(legacyBaselineEventId('family:child', 'member')).not.toBe(
      legacyBaselineEventId('family', 'child:member'),
    )
  })

  it('folds a zero XP reward without inventing XP', () => {
    const zeroKey = logicalCompletionKey('child', 'zero-task', 'day:2026-07-22')

    expect(foldXpEvents([
      { id: taskXpEventId(zeroKey), event: event({
        logicalCompletionKey: zeroKey, xpDelta: 0, idempotencyKey: taskXpEventId(zeroKey),
      }) },
    ])).toBe(0)
  })

  it.each(['child/1', 'child|1'])('rejects reserved task-key delimiters', (childId) => {
    expect(() => logicalCompletionKey(childId, 'task', 'day:2026-07-22')).toThrow()
  })
})

describe('foldXpEvents', () => {
  it('folds unordered immutable events', () => {
    expect(foldXpEvents([
      { id: 'bonus', event: event({ eventType: 'daily_goal_awarded', xpDelta: 25, sourceType: 'daily_progress', sourceId: 'day-1', logicalCompletionKey: undefined, idempotencyKey: 'daily_goal:family-1:child-1:2026-07-22' }) },
      { id: taskXpEventId(logicalKey), event: event() },
      { id: 'baseline', event: event({ eventType: 'legacy_xp_baseline', xpDelta: 100, sourceType: 'migration', sourceId: 'legacy_lifetime_xp', logicalCompletionKey: undefined, idempotencyKey: legacyBaselineEventId('family-1', 'child-1'), createdBy: 'legacy-xp-migration-v1' }) },
    ])).toBe(150)
  })

  it('folds safe mathematical totals independently of event delivery order', () => {
    const maximum = Number.MAX_SAFE_INTEGER
    const documents = [
      { id: 'maximum', event: event({ xpDelta: maximum, idempotencyKey: 'maximum' }) },
      { id: 'plus-one', event: event({ xpDelta: 1, idempotencyKey: 'plus-one' }) },
      { id: 'minus-one', event: event({ xpDelta: -1, idempotencyKey: 'minus-one' }) },
    ]

    expect(foldXpEvents(documents)).toBe(maximum)
    expect(foldXpEvents([documents[0], documents[2], documents[1]])).toBe(maximum)
  })

  it('folds two completion document IDs into one logical event', () => {
    const first = event({ sourceId: 'completion-document-a' })
    const retry = event({ sourceId: 'completion-document-b' })

    expect(foldXpEvents([
      { id: 'completion-document-a', event: first },
      { id: 'completion-document-b', event: retry },
    ])).toBe(25)
  })

  it('compares logical retries by fields rather than object property order', () => {
    const first = event({ sourceId: 'completion-document-a' })
    const retry = Object.fromEntries(
      Object.entries(event({ sourceId: 'completion-document-b' })).reverse(),
    ) as GamificationEventV1

    expect(foldXpEvents([
      { id: 'completion-document-a', event: first },
      { id: 'completion-document-b', event: retry },
    ])).toBe(25)
  })

  it('rejects conflicting snapshots for one logical event', () => {
    expect(() => foldXpEvents([
      { id: 'completion-document-a', event: event({ sourceId: 'completion-document-a' }) },
      { id: 'completion-document-b', event: event({ sourceId: 'completion-document-b', xpDelta: 30 }) },
    ])).toThrow(/integrity/i)
  })

  it('rejects duplicate document IDs', () => {
    expect(() => foldXpEvents([
      { id: 'same-document', event: event() },
      { id: 'same-document', event: event({ sourceId: 'completion-document-b' }) },
    ])).toThrow(/duplicate/i)
  })

  it('applies a causal task compensation after its award', () => {
    expect(foldXpEvents([
      { id: taskXpEventId(logicalKey), event: event() },
      { id: taskXpReversalEventId(logicalKey), event: event({
        eventType: 'xp_revoked', xpDelta: -25, sourceId: 'reversal-1', idempotencyKey: taskXpReversalEventId(logicalKey),
        causalEventId: taskXpEventId(logicalKey), causalGroupId: 'gamification_transition_v1|invalidation_v1|reversal-1', transitionRank: 1,
      }) },
    ])).toBe(0)
  })

  it('rejects a negative ledger rather than clamping it', () => {
    expect(() => foldXpEvents([
      { id: taskXpReversalEventId(logicalKey), event: event({
        eventType: 'xp_revoked', xpDelta: -25, idempotencyKey: taskXpReversalEventId(logicalKey), causalEventId: taskXpEventId(logicalKey),
      }) },
    ])).toThrow(/negative/i)
  })
})
