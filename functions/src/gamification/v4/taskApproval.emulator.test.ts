/**
 * Gamification V4 — Task 7.1 task-approval cutover, REAL Firestore emulator.
 *
 * Drives the Admin SDK against the local emulator end-to-end:
 *   - the V4 route writes exactly ONE TASK_APPROVED event with a deterministic id
 *   - the stored projection equals rebuildStateFromLedger() over the ledger
 *   - duplicate delivery is a no-op
 *   - no legacy rewardPoints / lifetimeXP document and no wallet doc is written
 *   - family / member isolation holds across real partitions
 *
 * Skipped automatically when no emulator is running; executed for real under
 * `firebase emulators:exec`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { applyTaskApprovalV4, type TaskApprovalFactsV4 } from './taskApprovalWriter'
import { readLedger, readState } from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-task71-int'
const OTHER_FAMILY = 'fam-task71-other'
const MEMBER = 'mem-1'

function facts(overrides: Partial<TaskApprovalFactsV4> = {}): TaskApprovalFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    completionId: 'completion-int-1',
    taskId: 'task-int-1',
    rewardPointsDelta: 15,
    xpDelta: 15,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

describeEmulator('Task 7.1 — V4 task approval against the real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-task71-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('writes exactly one deterministic TASK_APPROVED event and the rebuilt state', async () => {
    const result = await applyTaskApprovalV4(db, facts())

    expect(result.status).toBe('processed')
    expect(result.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', 'completion-int-1'))

    const ledger = await readLedger(db, FAMILY)
    const approvals = ledger.filter((e) => e.eventType === 'TASK_APPROVED')
    expect(approvals).toHaveLength(1)

    const stored = await readState(db, FAMILY, MEMBER)
    const expected = rebuildStateFromLedger(
      ledger.filter((e) => e.memberId === MEMBER),
      { updatedAt: facts().createdAt, projectionVersion: 1 },
    )
    expect(stored).toEqual(expected)
  })

  it('duplicate delivery is a no-op on the real emulator', async () => {
    const again = await applyTaskApprovalV4(db, facts())
    expect(again.status).toBe('duplicate')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger.filter((e) => e.eventType === 'TASK_APPROVED')).toHaveLength(1)
  })

  it('writes no legacy gamification document and no wallet document', async () => {
    const familyDoc = await db.collection('families').doc(FAMILY).get()
    const data = familyDoc.exists ? JSON.stringify(familyDoc.data()) : ''
    expect(data).not.toMatch(/lifetimeXp/i)
    expect(data).not.toMatch(/wallet/i)

    const collections = await db.collection('families').doc(FAMILY).listCollections()
    const names = collections.map((c) => c.id).sort()
    expect(names).toEqual(['gamification_events', 'gamification_state'])
  })

  it('keeps families and members isolated in real partitions', async () => {
    await applyTaskApprovalV4(db, facts({ familyId: OTHER_FAMILY, rewardPointsDelta: 3, xpDelta: 3 }))
    await applyTaskApprovalV4(db, facts({ memberId: 'mem-2', completionId: 'completion-int-2', rewardPointsDelta: 7, xpDelta: 7 }))

    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(15)
    expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)
    expect((await readState(db, OTHER_FAMILY, MEMBER))!.rewardPoints).toBe(3)
  })
})
