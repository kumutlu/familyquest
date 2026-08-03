import { describe, expect, it } from 'vitest'
import { GAMIFICATION_V3_SCHEMA_VERSION, type GamificationEventV3 } from './event'
import { taskApprovedEventId } from './ids'
import { reduceGamificationEventsV3 } from './reducer'
import {
  EVENTS_V3_COLLECTION_ID,
  PROHIBITED_EVENT_FIELDS,
  REQUIRED_EVENT_INDEXES,
  deserialiseEventV3,
  deserialiseStateV3,
  serialiseEventV3,
  serialiseStateV3,
} from './storage'
import { ValidationErrorV3 } from './validators'
import { resolveWeeklyContext } from './weeklyWindow'

const FAMILY = 'family-1'
const MEMBER = 'member-1'
const CTX = { weekly: resolveWeeklyContext({ timeZone: 'UTC' }), asOf: '2026-01-08T00:00:00.000Z' }

const event: GamificationEventV3 = {
  schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
  eventId: taskApprovedEventId(FAMILY, MEMBER, 't1'),
  eventType: 'TASK_APPROVED',
  familyId: FAMILY,
  memberId: MEMBER,
  sourceType: 'task_completion',
  sourceId: 't1',
  effectiveAt: '2026-01-05T10:00:00.000Z',
  createdAt: '2026-01-05T10:00:00.000Z',
  rewardPointsDelta: 5,
  xpDelta: 5,
  weeklyPointsDelta: 5,
  idempotencyKey: taskApprovedEventId(FAMILY, MEMBER, 't1'),
  metadata: {},
}

describe('shadow serialisation utilities', () => {
  it('round-trips an event without adding or losing fields', () => {
    const serialised = serialiseEventV3(event)
    expect(Object.keys(serialised).sort()).toEqual(Object.keys(event).sort())
    expect(deserialiseEventV3(serialised)).toEqual(event)
  })

  it('refuses prohibited legacy fields on the shadow event shape', () => {
    for (const prohibited of PROHIBITED_EVENT_FIELDS) {
      expect(() => serialiseEventV3({ ...event, [prohibited]: 1 } as GamificationEventV3)).toThrow(
        ValidationErrorV3,
      )
    }
  })

  it('round-trips a projection produced by the reducer', () => {
    const state = reduceGamificationEventsV3([event], CTX)
    expect(deserialiseStateV3(serialiseStateV3(state))).toEqual(state)
  })

  it('declares the index required by the documented shadow read pattern', () => {
    expect(REQUIRED_EVENT_INDEXES[0].collectionGroup).toBe(EVENTS_V3_COLLECTION_ID)
    expect(REQUIRED_EVENT_INDEXES[0].fields.map((f) => f.fieldPath)).toEqual(['memberId', 'effectiveAt'])
  })
})
