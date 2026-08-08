/**
 * Gamification V4 — Task 7.5 refund / reversal, REAL Firestore emulator.
 *
 * Skipped automatically when no emulator is running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { applyReversalV4 } from './reversalWriter'
import { applyTaskApprovalV4 } from './taskApprovalWriter'
import { readLedger, readState } from './repository'
import { purgeV4FamilyData } from './rollback'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task75-int'
const MEMBER = 'mem-1'
const APPROVAL_ID = eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', 'completion-int-1')

describeEmulator('Task 7.5 — V4 reversal against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task75-integration')
    db = getFirestore(app)
    await purgeV4FamilyData(db, FAMILY)
    await applyTaskApprovalV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      completionId: 'completion-int-1',
      taskId: 'task-int-1',
      rewardPointsDelta: 40,
      xpDelta: 40,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    })
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('appends a reversal that negates the original and leaves it intact', async () => {
    const result = await applyReversalV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      originalEventId: APPROVAL_ID,
      kind: 'REV',
      reason: 'invalidated',
    })

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger).toHaveLength(2)
    expect(ledger.find((e) => e.eventId === APPROVAL_ID)!.rewardPointsDelta).toBe(40)

    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(
        ledger.filter((e) => e.memberId === MEMBER),
        { updatedAt: result.event.createdAt, projectionVersion: 1 },
      ),
    )
    expect(stored!.rewardPoints).toBe(0)
    expect(stored!.xpTotal).toBe(0)
  })

  it('reversing twice is a no-op on the real emulator', async () => {
    const again = await applyReversalV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      originalEventId: APPROVAL_ID,
      kind: 'REV',
    })
    expect(again.status).toBe('duplicate')
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
  })

  it('supports data-level rollback of the family ledger', async () => {
    const purged = await purgeV4FamilyData(db, FAMILY)
    expect(purged.eventsDeleted).toBe(2)
    expect(await readState(db, FAMILY, MEMBER)).toBeNull()
  })
})
