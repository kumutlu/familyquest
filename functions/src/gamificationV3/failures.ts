import { type Firestore } from 'firebase-admin/firestore'

/**
 * Structured failure record for V3 shadow write failures.
 *
 * TEMPORARY BRIDGE (amendment 1): Each failure record includes the source
 * flow context needed for reconciliation. Phase 3 must move trigger-backed
 * flows to server-authoritative callable/transaction paths.
 */
export interface V3ShadowFailureRecord {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly memberId: string
  readonly sourceType: string
  readonly sourceId: string
  readonly failureStage: 'mapping' | 'event_write' | 'projection_write'
  readonly errorMessage: string
  readonly errorStack?: string
  readonly sourceSnapshot: Record<string, unknown>
  readonly failedAt: string
  readonly retryCount: number
  readonly resolved: boolean
  readonly resolvedAt?: string

  // Amendment 1 bridge fields — every bridge event/failure record includes:
  readonly sourceFlow: string
  readonly sourceDocumentId: string
  readonly legacyCommittedAt: string
  readonly shadowObservedAt: string
  readonly bridgeVersion: string
  readonly lastError?: string
  readonly reconciliationStatus: 'pending' | 'resolved' | 'dead_letter'
}

export interface V3FailureRecorder {
  recordFailure(record: Omit<V3ShadowFailureRecord, 'schemaVersion'>): Promise<void>
  resolveFailure(familyId: string, failureId: string, resolvedAt: string): Promise<void>
}

const FAILURES_COLLECTION = 'gamification_v3_failures'

export class AdminV3FailureRecorder implements V3FailureRecorder {
  constructor(private readonly db: Firestore) {}

  async recordFailure(record: Omit<V3ShadowFailureRecord, 'schemaVersion'>): Promise<void> {
    const failureId = `${record.sourceType}:${record.sourceId}:${record.failureStage}`
    const docPath = `families/${record.familyId}/${FAILURES_COLLECTION}/${failureId}`
    await this.db.doc(docPath).set({
      schemaVersion: 1,
      ...record,
    })
  }

  async resolveFailure(familyId: string, failureId: string, resolvedAt: string): Promise<void> {
    const docPath = `families/${familyId}/${FAILURES_COLLECTION}/${failureId}`
    await this.db.doc(docPath).update({
      resolved: true,
      resolvedAt,
    })
  }
}