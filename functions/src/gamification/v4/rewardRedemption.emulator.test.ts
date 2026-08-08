/**
 * Gamification V4 — Task 7.4 reward redemption, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import {
  applyRewardRedemptionV4,
  InsufficientRewardPointsError,
  type RewardRedemptionFactsV4,
} from './rewardRedemptionWriter'
import { applyBehaviourV4 } from './behaviourWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task74-int'
const MEMBER = 'mem-1'

function facts(overrides: Partial<RewardRedemptionFactsV4> = {}): RewardRedemptionFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    redemptionId: 'red-int-1',
    rewardId: 'reward-int-1',
    cost: 30,
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    ...overrides,
  }
}

describeEmulator('Task 7.4 — V4 reward redemption against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task74-integration')
    db = getFirestore(app)
    await purgeV4FamilyData(db, FAMILY)
    await applyBehaviourV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      logId: 'fund-int-1',
      behaviourId: 'beh-fund',
      direction: 'positive',
      points: 50,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    })
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('charges points once with a deterministic id and a rebuilt projection', async () => {
    const result = await applyRewardRedemptionV4(db, facts())
    expect(result.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'REWARD_REDEEMED', 'red-int-1'))

    const ledger = await readLedger(db, FAMILY)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(
        ledger.filter((e) => e.memberId === MEMBER),
        { updatedAt: facts().createdAt, projectionVersion: 1 },
      ),
    )
    expect(stored!.rewardPoints).toBe(20)
    expect(stored!.xpTotal).toBe(50)
  })

  it('duplicate delivery never double-charges on the real emulator', async () => {
    const again = await applyRewardRedemptionV4(db, facts())
    expect(again.status).toBe('duplicate')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(20)
  })

  it('rejects an unaffordable redemption and writes nothing', async () => {
    await expect(
      applyRewardRedemptionV4(db, facts({ redemptionId: 'red-int-2', cost: 999 })),
    ).rejects.toBeInstanceOf(InsufficientRewardPointsError)
    expect(
      (await readLedger(db, FAMILY)).filter((e) => e.sourceId === 'red-int-2'),
    ).toHaveLength(0)
  })

  it('supports data-level rollback of the family ledger', async () => {
    const purged = await purgeV4FamilyData(db, FAMILY)
    expect(purged.eventsDeleted).toBeGreaterThan(0)
    expect(await readState(db, FAMILY, MEMBER)).toBeNull()
  })
})
