import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { dailyCheckinDocumentId, type DailyCheckinAnimal } from './dailyCheckins';

export type DailyCheckinWriteResult = {
  status: 'written' | 'already-checked-in' | 'already-skipped';
};

export type SubmitDailyCheckinInput = {
  familyId: string;
  userId: string;
  localDate: string;
  animal: DailyCheckinAnimal;
};

export type SkipDailyCheckinInput = Omit<SubmitDailyCheckinInput, 'animal'>;

const checkinReferences = (familyId: string, userId: string, localDate: string) => {
  const id = dailyCheckinDocumentId(userId, localDate);
  return {
    checkinRef: doc(db, `families/${familyId}/daily_checkins/${id}`),
    skipRef: doc(db, `families/${familyId}/daily_checkin_skips/${id}`),
  };
};

export async function submitDailyCheckin(input: SubmitDailyCheckinInput): Promise<DailyCheckinWriteResult> {
  const { checkinRef, skipRef } = checkinReferences(input.familyId, input.userId, input.localDate);

  return runTransaction(db, async transaction => {
    const [checkin, skip] = await Promise.all([transaction.get(checkinRef), transaction.get(skipRef)]);
    if (checkin.exists()) {
      if (skip.exists()) transaction.delete(skipRef);
      return { status: 'already-checked-in' };
    }

    const now = serverTimestamp();
    transaction.set(checkinRef, { ...input, catalogVersion: 1, createdAt: now, updatedAt: now });
    if (skip.exists()) transaction.delete(skipRef);
    return { status: 'written' };
  });
}

export async function skipDailyCheckin(input: SkipDailyCheckinInput): Promise<DailyCheckinWriteResult> {
  const { checkinRef, skipRef } = checkinReferences(input.familyId, input.userId, input.localDate);

  return runTransaction(db, async transaction => {
    const checkin = await transaction.get(checkinRef);
    if (checkin.exists()) return { status: 'already-checked-in' };

    const skip = await transaction.get(skipRef);
    if (skip.exists()) return { status: 'already-skipped' };

    transaction.set(skipRef, { ...input, createdAt: serverTimestamp() });
    return { status: 'written' };
  });
}
