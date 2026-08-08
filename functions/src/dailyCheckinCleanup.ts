import type { Firestore } from 'firebase-admin/firestore';

const DAILY_CHECKIN_COLLECTIONS = ['daily_checkins', 'daily_checkin_skips'] as const;
const BATCH_LIMIT = 500;

/** Delete all daily check-in records owned by one globally unique user ID. */
export async function purgeUserDailyCheckinRecords(db: Firestore, uid: string): Promise<void> {
  for (const collectionName of DAILY_CHECKIN_COLLECTIONS) {
    while (true) {
      const snapshot = await db.collectionGroup(collectionName)
        .where('userId', '==', uid)
        .limit(BATCH_LIMIT)
        .get();
      if (snapshot.empty) break;

      const batch = db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
    }
  }
}
