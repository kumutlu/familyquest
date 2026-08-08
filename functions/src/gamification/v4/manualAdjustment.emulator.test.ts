/**
 * Gamification V4 — Task 7.7 manual adjustment, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { applyManualAdjustmentV4, type ManualAdjustmentFactsV4 } from './manualAdjustmentWriter'
import { applyBehaviourV4 } from './behaviourWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task77-int'
const MEMBER = 'mem-1'

function facts(overrides: Partial<ManualAdjustmentFactsV4> = {}): ManualAdjustmentFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    adjustmentId: 'adj-int-1',
    rewardPointsDelta: 25,
    reason: 'helped with the shopping',
    adjustedBy: 'parent-1',
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    ...overrides,
  }
}

describeEmulator('Task 7.7 — V4 manual adjustment against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task77-integration')
    db = getFirestore(app)
    await purgeV4FamilyData(db, FAMILY)
    await applyBehaviourV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      logId: 'fund-int-1',
      behaviourId: 'beh-fund',
      direction: 'positive',
      points: 10,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    })
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('grants points without XP and rebuilds the projection', async () => {
    const result = await applyManualAdjustmentV4(db, facts())
    expect(result.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'MANUAL_ADJUSTMENT', 'adj-int-1'))

    const ledger = await readLedger(db, FAMILY)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(
        ledger.filter((e) => e.memberId === MEMBER),
        { updatedAt: facts().createdAt, projectionVersion: 1 },
      ),
    )
    expect(stored!.rewardPoints).toBe(35)
    expect(stored!.xpTotal).toBe(10)
  })

  it('duplicate delivery is a no-op on the real emulator', async () => {
    const again = await applyManualAdjustmentV4(db, facts())
    expect(again.status).toBe('duplicate')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)
  })

  it('a deduction clamps the balance at zero', async () => {
    await applyManualAdjustmentV4(
      db,
      facts({ adjustmentId: 'adj-int-2', rewardPointsDelta: -999, reason: 'reset' }),
    )
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.rewardPoints).toBe(0)
    expect(stored!.xpTotal).toBe(10)
  })

  it('supports data-level rollback of the family ledger', async () => {
    const purged = await purgeV4FamilyData(db, FAMILY)
    expect(purged.eventsDeleted).toBeGreaterThan(0)
    expect(await readState(db, FAMILY, MEMBER)).toBeNull()
  })
})
