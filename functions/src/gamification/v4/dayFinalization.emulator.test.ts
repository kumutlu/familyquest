/**
 * Gamification V4 — Task 7.3 day finalization, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { applyDayFinalizationV4, type DayFinalizationFactsV4 } from './dayFinalizationWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task73-int'
const MEMBER = 'mem-1'
const DAY = '2026-01-05'

function facts(overrides: Partial<DayFinalizationFactsV4> = {}): DayFinalizationFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    dayKey: DAY,
    dailyGoal: { rewardPoints: 10, xp: 10 },
    perfectDay: { rewardPoints: 25, xp: 25 },
    effectiveAt: `${DAY}T23:59:00.000Z`,
    createdAt: `${DAY}T23:59:00.000Z`,
    ...overrides,
  }
}

describeEmulator('Task 7.3 — V4 day finalization against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task73-integration')
    db = getFirestore(app)
    await purgeV4FamilyData(db, FAMILY)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('writes both day awards with deterministic ids and a rebuilt projection', async () => {
    const result = await applyDayFinalizationV4(db, facts())

    expect(result.dailyGoal!.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'DAILY_GOAL_AWARDED', DAY))
    expect(result.perfectDay!.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'PERFECT_DAY_AWARDED', DAY))

    const ledger = await readLedger(db, FAMILY)
    expect(ledger).toHaveLength(2)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(
        ledger.filter((e) => e.memberId === MEMBER),
        { updatedAt: facts().createdAt, projectionVersion: 1 },
      ),
    )
    expect(stored!.rewardPoints).toBe(35)
  })

  it('re-finalising the same day is a no-op on the real emulator', async () => {
    const again = await applyDayFinalizationV4(db, facts())
    expect(again.dailyGoal!.status).toBe('duplicate')
    expect(again.perfectDay!.status).toBe('duplicate')
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
  })

  it('supports data-level rollback of the family ledger', async () => {
    const purged = await purgeV4FamilyData(db, FAMILY)
    expect(purged.eventsDeleted).toBe(2)
    expect(await readState(db, FAMILY, MEMBER)).toBeNull()
  })
})
