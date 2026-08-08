/**
 * Gamification V4 — Task 7.2 behaviour cutover, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running; executed for real under
 * `firebase emulators:exec`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { applyBehaviourV4, type BehaviourFactsV4 } from './behaviourWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task72-int'
const OTHER_FAMILY = 'fam-task72-other'
const MEMBER = 'mem-1'

function facts(overrides: Partial<BehaviourFactsV4> = {}): BehaviourFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    logId: 'log-int-1',
    behaviourId: 'beh-int-1',
    direction: 'positive',
    points: 12,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

describeEmulator('Task 7.2 — V4 behaviour writer against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task72-integration')
    db = getFirestore(app)
    await purgeV4FamilyData(db, FAMILY)
    await purgeV4FamilyData(db, OTHER_FAMILY)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('writes exactly one deterministic behaviour event and the rebuilt state', async () => {
    const result = await applyBehaviourV4(db, facts())

    expect(result.status).toBe('processed')
    expect(result.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'BEHAVIOUR_POSITIVE', 'log-int-1'))

    const ledger = await readLedger(db, FAMILY)
    expect(ledger.filter((e) => e.eventType === 'BEHAVIOUR_POSITIVE')).toHaveLength(1)

    const stored = await readState(db, FAMILY, MEMBER)
    const expected = rebuildStateFromLedger(
      ledger.filter((e) => e.memberId === MEMBER),
      { updatedAt: facts().createdAt, projectionVersion: 1 },
    )
    expect(stored).toEqual(expected)
  })

  it('duplicate delivery is a no-op on the real emulator', async () => {
    const again = await applyBehaviourV4(db, facts())
    expect(again.status).toBe('duplicate')
    expect((await readLedger(db, FAMILY)).filter((e) => e.eventType === 'BEHAVIOUR_POSITIVE')).toHaveLength(1)
  })

  it('a negative behaviour debits points, never XP, and the state stays a pure rebuild', async () => {
    const last = await applyBehaviourV4(
      db,
      facts({ logId: 'log-int-2', direction: 'negative', points: 5 }),
    )
    const ledger = await readLedger(db, FAMILY)
    const expected = rebuildStateFromLedger(
      ledger.filter((e) => e.memberId === MEMBER),
      { updatedAt: last.event.createdAt, projectionVersion: 1 },
    )
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(expected)
    expect(stored!.rewardPoints).toBe(7)
    expect(stored!.xpTotal).toBe(12)
  })

  it('writes no legacy gamification document and no wallet document', async () => {
    const collections = await db.collection('families').doc(FAMILY).listCollections()
    expect(collections.map((c) => c.id).sort()).toEqual(['gamification_events', 'gamification_state'])
  })

  it('keeps families isolated and supports data-level rollback', async () => {
    await applyBehaviourV4(db, facts({ familyId: OTHER_FAMILY, points: 3 }))
    expect((await readState(db, OTHER_FAMILY, MEMBER))!.rewardPoints).toBe(3)

    const purged = await purgeV4FamilyData(db, OTHER_FAMILY)
    expect(purged.eventsDeleted).toBeGreaterThan(0)
    expect(await readState(db, OTHER_FAMILY, MEMBER)).toBeNull()
    // The other family is untouched by the rollback.
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(7)
  })
})
