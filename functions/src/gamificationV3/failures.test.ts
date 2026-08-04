import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3FailureRecorder, type V3ShadowFailureRecord } from './failures'

const FAMILY = 'test-family'

function createMockDb(): Firestore {
  const store = new Map<string, Record<string, unknown>>()
  return {
    doc: (path: string) => {
      const segments = path.split('/')
      const id = segments[segments.length - 1]
      return {
        set: async (data: Record<string, unknown>) => { store.set(id, data) },
        update: async (data: Record<string, unknown>) => {
          const existing = store.get(id) ?? {}
          store.set(id, { ...existing, ...data })
        },
        get: async () => {
          const data = store.get(id)
          return { exists: data !== undefined, data: () => data ?? null }
        },
      }
    },
  } as unknown as Firestore
}

describe('AdminV3FailureRecorder', () => {
  let recorder: AdminV3FailureRecorder
  let db: Firestore

  beforeEach(() => {
    db = createMockDb()
    recorder = new AdminV3FailureRecorder(db)
  })

  it('records a structured failure when shadow write fails', async () => {
    await recorder.recordFailure({
      familyId: FAMILY,
      memberId: 'member-1',
      sourceType: 'task_completion',
      sourceId: 'completion-1',
      failureStage: 'event_write',
      errorMessage: 'DEADLINE_EXCEEDED',
      sourceSnapshot: {},
      failedAt: '2026-01-05T10:00:00.000Z',
      retryCount: 1,
      resolved: false,
      // Amendment 1 bridge fields
      sourceFlow: 'task_approval',
      sourceDocumentId: 'completion-1',
      legacyCommittedAt: '2026-01-05T10:00:00.000Z',
      shadowObservedAt: '2026-01-05T10:00:01.000Z',
      bridgeVersion: 'phase-2-bridge-v1',
      reconciliationStatus: 'pending',
    })

    const doc = await db.doc(`families/${FAMILY}/gamification_v3_failures/task_completion:completion-1:event_write`).get()
    expect(doc.exists).toBe(true)
    expect((doc.data() as any).schemaVersion).toBe(1)
    expect((doc.data() as any).errorMessage).toBe('DEADLINE_EXCEEDED')
    expect((doc.data() as any).bridgeVersion).toBe('phase-2-bridge-v1')
  })

  it('resolves a failure record', async () => {
    await recorder.recordFailure({
      familyId: FAMILY,
      memberId: 'member-1',
      sourceType: 'task_completion',
      sourceId: 'completion-1',
      failureStage: 'event_write',
      errorMessage: 'DEADLINE_EXCEEDED',
      sourceSnapshot: {},
      failedAt: '2026-01-05T10:00:00.000Z',
      retryCount: 1,
      resolved: false,
      sourceFlow: 'task_approval',
      sourceDocumentId: 'completion-1',
      legacyCommittedAt: '2026-01-05T10:00:00.000Z',
      shadowObservedAt: '2026-01-05T10:00:01.000Z',
      bridgeVersion: 'phase-2-bridge-v1',
      reconciliationStatus: 'pending',
    })

    await recorder.resolveFailure(FAMILY, 'task_completion:completion-1:event_write', '2026-01-05T11:00:00.000Z')
    const doc = await db.doc(`families/${FAMILY}/gamification_v3_failures/task_completion:completion-1:event_write`).get()
    expect((doc.data() as any).resolved).toBe(true)
    expect((doc.data() as any).resolvedAt).toBe('2026-01-05T11:00:00.000Z')
  })
})