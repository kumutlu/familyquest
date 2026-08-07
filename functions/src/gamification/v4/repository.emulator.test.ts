/**
 * Gamification V4 — REAL Firestore emulator integration for the canonical
 * state storage path (path alignment fix).
 *
 * The unit tests in `repository.test.ts` use an in-memory Firestore double.
 * This suite drives the SAME repository functions against a REAL Firestore
 * emulator through the Admin SDK, proving end-to-end that:
 *
 *   - `writeState` persists to `families/{familyId}/gamification_state/{memberId}`
 *     (docs/gamification-v4-design.md §2.4);
 *   - NO document is created at the old root-level `gamification_state/{memberId}`;
 *   - exactly ONE V4 state document exists per member (no alias, no duplicate);
 *   - state is family-partitioned, so family A cannot address family B's state;
 *   - the backend (Admin SDK) write succeeds;
 *   - reads and rebuild use exactly the same path derivation.
 *
 * Skipped automatically when no emulator is running; executed for real under
 * `firebase emulators:exec`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { readLedger, readState, writeEventIdempotent, writeState } from './repository'
import {
  STATE_V4_COLLECTION_ID,
  eventDocPath,
  stateDocPath,
} from '../../../../src/domain/gamification/v4/storage'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import type { GamificationStateV4 } from '../../../../src/domain/gamification/v4/types'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeWithEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY_A = 'v4-path-fam-A'
const FAMILY_B = 'v4-path-fam-B'
const MEMBER = 'v4-path-mem-1'

function makeState(overrides: Partial<GamificationStateV4> = {}): GamificationStateV4 {
  return {
    rewardPoints: 20,
    xpTotal: 20,
    level: 1,
    xpProgressInLevel: 20,
    xpToNextLevel: 980,
    levelProgressPercentage: 2,
    currentStreak: 1,
    bestStreak: 1,
    lastQualifiedDayKey: '2026-01-05',
    unlockedAchievementIds: [],
    unlockedAvatarIds: [],
    projectionVersion: 1,
    foldedThroughEventId: null,
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

function makeEvent(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  const base: GamificationEventV4 = {
    schemaVersion: 4 as const,
    familyId: FAMILY_A,
    memberId: MEMBER,
    eventType: 'TASK_APPROVED',
    sourceType: 'task_completion',
    sourceId: 'task-1#2026-01-05',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 20,
    xpDelta: 20,
    metadata: {},
    estimated: false,
  } as GamificationEventV4
  const merged = { ...base, ...overrides }
  if (overrides.eventId === undefined) {
    merged.eventId = eventIdFor(merged.familyId, merged.memberId, merged.eventType, merged.sourceId)
  }
  return merged
}

describeWithEmulator('V4 canonical state path — real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-canonical-path-integration')
    db = getFirestore(app)
  })

  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('backend write succeeds and lands on the canonical family-scoped path', async () => {
    const state = makeState()
    await writeState(db, FAMILY_A, MEMBER, state)

    const snap = await db.doc(stateDocPath(FAMILY_A, MEMBER)).get()
    expect(snap.exists).toBe(true)
    expect(snap.get('rewardPoints')).toBe(20)
    expect(snap.ref.path).toBe(`families/${FAMILY_A}/${STATE_V4_COLLECTION_ID}/${MEMBER}`)
  })

  it('creates NO document at the old root-level gamification_state path', async () => {
    await writeState(db, FAMILY_A, MEMBER, makeState())
    const legacy = await db.doc(`${STATE_V4_COLLECTION_ID}/${MEMBER}`).get()
    expect(legacy.exists).toBe(false)
  })

  it('leaves exactly one V4 state document for the member (no duplicate anywhere)', async () => {
    await writeState(db, FAMILY_A, MEMBER, makeState())

    // Collection-group scan finds every gamification_state doc in the project.
    const group = await db.collectionGroup(STATE_V4_COLLECTION_ID).get()
    const paths = group.docs.map((d) => d.ref.path).filter((p) => p.endsWith(`/${MEMBER}`))
    expect(paths).toEqual([`families/${FAMILY_A}/${STATE_V4_COLLECTION_ID}/${MEMBER}`])
  })

  it('partitions state by family: family A cannot address family B state', async () => {
    await writeState(db, FAMILY_A, MEMBER, makeState({ rewardPoints: 20 }))
    await writeState(db, FAMILY_B, MEMBER, makeState({ rewardPoints: 99 }))

    const a = await db.doc(stateDocPath(FAMILY_A, MEMBER)).get()
    const b = await db.doc(stateDocPath(FAMILY_B, MEMBER)).get()

    expect(a.get('rewardPoints')).toBe(20)
    expect(b.get('rewardPoints')).toBe(99)
    expect(a.ref.path).not.toBe(b.ref.path)
  })

  it('read uses the same path the write used', async () => {
    const state = makeState({ rewardPoints: 42 })
    await writeState(db, FAMILY_A, MEMBER, state)
    const read = await readState(db, FAMILY_A, MEMBER)
    expect(read?.rewardPoints).toBe(42)
  })

  it('returns null for a member with no state in this family (no cross-family fallback)', async () => {
    expect(await readState(db, FAMILY_B, 'nobody-here')).toBeNull()
  })

  it('rebuild round-trip writes the rebuilt projection to the canonical path', async () => {
    const events = [
      makeEvent({ sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({
        eventType: 'BEHAVIOUR_POSITIVE',
        sourceType: 'behaviour',
        sourceId: 'beh-1',
        rewardPointsDelta: 20,
        xpDelta: 20,
      }),
      makeEvent({
        eventType: 'REWARD_REDEEMED',
        sourceType: 'reward_redemption',
        sourceId: 'rew-1',
        rewardPointsDelta: -10,
        xpDelta: 0,
      }),
    ]
    for (const e of events) await writeEventIdempotent(db, e)

    // Events remain on their canonical path too.
    const evtSnap = await db.doc(eventDocPath(FAMILY_A, events[0].eventId)).get()
    expect(evtSnap.exists).toBe(true)

    const rebuilt = rebuildStateFromLedger(await readLedger(db, FAMILY_A), {
      updatedAt: '2026-01-05T10:00:00.000Z',
      projectionVersion: 1,
    })
    await writeState(db, FAMILY_A, MEMBER, rebuilt)

    const stored = (await readState(db, FAMILY_A, MEMBER)) as GamificationStateV4
    expect(businessFields(stored)).toEqual(businessFields(rebuilt))
    expect(stored.rewardPoints).toBe(30) // 20 + 20 - 10
    expect(stored.xpTotal).toBe(40) // 20 + 20
  })

  it('never writes a wallet field to the canonical state document', async () => {
    await writeState(db, FAMILY_A, MEMBER, makeState())
    const snap = await db.doc(stateDocPath(FAMILY_A, MEMBER)).get()
    const keys = Object.keys(snap.data() ?? {})
    expect(keys.some((k) => /wallet/i.test(k))).toBe(false)
  })
})
