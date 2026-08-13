import { describe, expect, it } from 'vitest'
import { normalizeXpLedger, UnknownXpEventError } from './rebuildNormalization'

const FAMILY = '5s4Npeu55wPphLCsGAMP'
const ALISYA = 'NuyIJDP9fDNP2LiKynlsEyzur5N2'
const MOSTIUM = 'T7ZsdaN8ixUOnzRAX9jNQqUDZE13'
const MNALIUM = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2'

const at = (millis: number) => ({ toMillis: () => millis })

function canonical(id: string, childId: string, xpDelta: number, eventType = 'xp_awarded') {
  return {
    id,
    data: {
      schemaVersion: 1, familyId: FAMILY, childId, eventType, xpDelta,
      sourceType: 'task_completion', sourceId: id, idempotencyKey: id,
      causalGroupId: `group:${id}`, transitionRank: 0,
      effectiveAt: at(1_800_000_000_000), createdAt: at(1_800_000_000_001),
      configSchemaVersion: 1, createdBy: 'gamification-engine-v1',
    },
  }
}

function behaviour(id: string, childId: string, xpDelta: number) {
  return {
    id: `behaviour_xp:${id}`,
    data: {
      schemaVersion: 1, familyId: FAMILY, childId, eventType: 'behaviour_positive', xpDelta,
      sourceType: 'behaviour_event', sourceId: id, idempotencyKey: `behaviour_xp:${id}`,
      effectiveAt: at(1_800_000_000_100), createdAt: at(1_800_000_000_101),
      configSchemaVersion: 1, createdBy: 'behaviour-processor-v1',
    },
  }
}

function baseline(childId: string, xpDelta: number) {
  const id = `legacy_xp_baseline:${FAMILY}:${childId}`
  return canonical(id, childId, xpDelta, 'legacy_xp_baseline')
}

describe('historical XP rebuild normalization', () => {
  it('folds the three production-shaped ledgers to the proven canonical totals', () => {
    const documents = [
      baseline(ALISYA, 86), canonical('alisya-task', ALISYA, 605), canonical('alisya-daily', ALISYA, 25, 'daily_goal_awarded'),
      canonical('alisya-perfect', ALISYA, 50, 'perfect_day_awarded'), behaviour(`challenge_reward__challenge__${ALISYA}`, ALISYA, 100),
      baseline(MOSTIUM, 90), canonical('mostium-task', MOSTIUM, 425), canonical('mostium-reversal', MOSTIUM, -30, 'xp_revoked'),
      behaviour('mostium-behaviour', MOSTIUM, 10), behaviour(`challenge_reward__challenge__${MOSTIUM}`, MOSTIUM, 100),
      baseline(MNALIUM, 380), canonical('mnalium-task', MNALIUM, 205), behaviour('mnalium-behaviour', MNALIUM, 72),
      behaviour(`challenge_reward__challenge__${MNALIUM}`, MNALIUM, 100),
      {
        id: 'behaviour_xp_backfill:SXkg6R4vxWTJowdJXdLA',
        data: { childId: MNALIUM, eventType: 'xp_backfill', sourceId: 'SXkg6R4vxWTJowdJXdLA', xpDelta: 20,
          effectiveAt: at(1_800_000_000_200), createdAt: at(1_800_000_000_200) },
      },
      {
        id: `task_xp:task_v1|${MNALIUM}|c3WmeyXGkvhwVe7mWTiq|2026-08-03`,
        data: { childId: MNALIUM, eventType: 'task_completion', sourceId: `${MNALIUM}__c3WmeyXGkvhwVe7mWTiq__2026-08-03`, xpDelta: 20,
          effectiveAt: at(1_800_000_000_201), createdAt: at(1_800_000_000_201) },
      },
    ]

    const normalized = normalizeXpLedger({ familyId: FAMILY, documents })
    const totals = Object.fromEntries([ALISYA, MOSTIUM, MNALIUM].map(childId => [
      childId,
      normalized.filter(document => document.event.childId === childId).reduce((sum, document) => sum + document.event.xpDelta, 0),
    ]))

    expect(totals).toEqual({ [ALISYA]: 866, [MOSTIUM]: 595, [MNALIUM]: 797 })
    expect(normalized.filter(document => document.normalization === 'legacy').map(document => document.id)).toEqual([
      'behaviour_xp_backfill:SXkg6R4vxWTJowdJXdLA',
      `task_xp:task_v1|${MNALIUM}|c3WmeyXGkvhwVe7mWTiq|2026-08-03`,
    ])
    expect(normalized.every(document => document.event.causalGroupId.length > 0 && Number.isInteger(document.event.transitionRank))).toBe(true)
  })

  it('fails closed with the document identity for an unknown XP-bearing shape', () => {
    expect(() => normalizeXpLedger({
      familyId: FAMILY,
      documents: [{ id: 'mystery-xp', data: { childId: ALISYA, eventType: 'surprise', xpDelta: 9, createdAt: at(123) } }],
    })).toThrowError(new UnknownXpEventError('mystery-xp', 'unsupported XP-bearing event shape'))
  })
})
