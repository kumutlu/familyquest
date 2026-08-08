import { type Firestore } from 'firebase-admin/firestore'
import {
  type GamificationEventV3,
} from '../../../src/domain/gamification/v3/event'
import {
  eventDocPath,
  EVENTS_V3_COLLECTION_ID,
  serialiseEventV3,
  deserialiseEventV3,
} from '../../../src/domain/gamification/v3/storage'

// ---------------------------------------------------------------------------
// Interface consumed by shadowWriter.ts
// ---------------------------------------------------------------------------

export interface V3EventRepository {
  /** Write one V3 event document. Idempotent: same eventId overwrites identically. */
  writeEvent(familyId: string, event: GamificationEventV3): Promise<void>

  /** Read a single event by eventId. Returns null if not found. */
  readEvent(familyId: string, eventId: string): Promise<GamificationEventV3 | null>

  /** Read all events for a member, ordered by effectiveAt. */
  readMemberEvents(familyId: string, memberId: string): Promise<readonly GamificationEventV3[]>
}

// ---------------------------------------------------------------------------
// Admin SDK implementation — bypasses security rules, intended for use in
// Cloud Functions and trusted tooling only.
// ---------------------------------------------------------------------------

export class AdminV3EventRepository implements V3EventRepository {
  constructor(private readonly db: Firestore) {}

  async writeEvent(familyId: string, event: GamificationEventV3): Promise<void> {
    await this.db.doc(eventDocPath(familyId, event.eventId)).set(serialiseEventV3(event))
  }

  async readEvent(familyId: string, eventId: string): Promise<GamificationEventV3 | null> {
    const doc = await this.db.doc(eventDocPath(familyId, eventId)).get()
    if (!doc.exists) return null
    return deserialiseEventV3(doc.data()!)
  }

  async readMemberEvents(familyId: string, memberId: string): Promise<readonly GamificationEventV3[]> {
    const snapshot = await this.db
      .collection(`families/${familyId}/${EVENTS_V3_COLLECTION_ID}`)
      .where('memberId', '==', memberId)
      .orderBy('effectiveAt')
      .get()
    return snapshot.docs.map(doc => deserialiseEventV3(doc.data()!))
  }
}