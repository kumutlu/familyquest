/**
 * Gamification V4 — Task 7.6 avatar unlock, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import {
  applyAvatarUnlockV4,
  InsufficientPointsForAvatarError,
  type AvatarUnlockFactsV4,
} from './avatarUnlockWriter'
import { applyBehaviourV4 } from './behaviourWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task76-int'
const MEMBER = 'mem-1'

function facts(overrides: Partial<AvatarUnlockFactsV4> = {}): AvatarUnlockFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    avatarId: 'avatar-fox',
    cost: 20,
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    ...overrides,
  }
}

describeEmulator('Task 7.6 — V4 avatar unlock against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task76-integration')
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

  it('unlocks once with a deterministic id and a rebuilt projection', async () => {
    const result = await applyAvatarUnlockV4(db, facts())
    expect(result.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'AVATAR_UNLOCKED', 'avatar-fox'))

    const ledger = await readLedger(db, FAMILY)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(
        ledger.filter((e) => e.memberId === MEMBER),
        { updatedAt: facts().createdAt, projectionVersion: 1 },
      ),
    )
    expect(stored!.rewardPoints).toBe(30)
    expect(stored!.unlockedAvatarIds).toEqual(['avatar-fox'])
  })

  it('re-unlocking is a no-op on the real emulator', async () => {
    const again = await applyAvatarUnlockV4(db, facts())
    expect(again.status).toBe('duplicate')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)
  })

  it('rejects an unaffordable unlock and writes nothing', async () => {
    await expect(
      applyAvatarUnlockV4(db, facts({ avatarId: 'avatar-dragon', cost: 999 })),
    ).rejects.toBeInstanceOf(InsufficientPointsForAvatarError)
    expect((await readState(db, FAMILY, MEMBER))!.unlockedAvatarIds).toEqual(['avatar-fox'])
  })

  it('supports data-level rollback of the family ledger', async () => {
    const purged = await purgeV4FamilyData(db, FAMILY)
    expect(purged.eventsDeleted).toBeGreaterThan(0)
    expect(await readState(db, FAMILY, MEMBER)).toBeNull()
  })
})
