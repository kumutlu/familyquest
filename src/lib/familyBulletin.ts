import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export const ANNOUNCEMENT_TYPES = [
  'general', 'rule_change', 'consequence', 'new_task', 'reward_update', 'event', 'urgent',
] as const;
export const AUDIENCE_TYPES = ['family', 'children', 'adults', 'selected'] as const;
export const PRIORITIES = ['normal', 'important', 'urgent'] as const;

export type AnnouncementType = typeof ANNOUNCEMENT_TYPES[number];
export type AnnouncementAudience = typeof AUDIENCE_TYPES[number];
export type AnnouncementPriority = typeof PRIORITIES[number];

export interface FamilyAnnouncement {
  id: string;
  familyId: string;
  title: string;
  message: string;
  type: AnnouncementType;
  audienceType: AnnouncementAudience;
  audienceUserIds: string[];
  priority: AnnouncementPriority;
  startsAt?: unknown;
  expiresAt?: unknown;
  pinned: boolean;
  status: 'active' | 'archived';
  linkedTaskId?: string;
  linkedRewardId?: string;
  linkedSettingChangeId?: string;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

const millis = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof (value as any).toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any).toDate === 'function') return (value as any).toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return null;
};

export function isAnnouncementActive(item: FamilyAnnouncement, now = new Date()): boolean {
  const current = now.getTime();
  const starts = millis(item.startsAt);
  const expires = millis(item.expiresAt);
  return item.status === 'active'
    && (starts == null || starts <= current)
    && (expires == null || expires > current);
}

export function canUserSeeAnnouncement(
  item: FamilyAnnouncement,
  user: { id: string; role: string },
): boolean {
  if (user.role === 'owner' || user.role === 'parent') return true;
  return item.audienceType === 'family'
    || item.audienceType === 'children'
    || (item.audienceType === 'selected' && item.audienceUserIds.includes(user.id));
}

const priorityRank = { normal: 0, important: 1, urgent: 2 };
export function sortAnnouncements(items: FamilyAnnouncement[]): FamilyAnnouncement[] {
  return [...items].sort((left, right) =>
    Number(right.pinned) - Number(left.pinned)
    || priorityRank[right.priority] - priorityRank[left.priority]
    || (millis(right.createdAt) ?? 0) - (millis(left.createdAt) ?? 0),
  );
}

export function subscribeToAnnouncements(
  familyId: string,
  user: { id: string; role: string },
  onNext: (items: FamilyAnnouncement[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  const base = collection(db, `families/${familyId}/announcements`);
  const parent = user.role === 'owner' || user.role === 'parent';
  const targets: Query<DocumentData>[] = parent
    ? [query(base)]
    : [
      query(base, where('audienceType', '==', 'family')),
      query(base, where('audienceType', '==', 'children')),
      query(base, where('audienceType', '==', 'selected'), where('audienceUserIds', 'array-contains', user.id)),
    ];
  const buckets = new Map<number, FamilyAnnouncement[]>();
  const emit = () => {
    const merged = new Map<string, FamilyAnnouncement>();
    buckets.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onNext(Array.from(merged.values()));
  };
  const unsubscribes = targets.map((target, index) => onSnapshot(
    target,
    snapshot => {
      buckets.set(index, snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as FamilyAnnouncement));
      emit();
    },
    onError,
  ));
  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}

export function subscribeToAnnouncementReads(
  familyId: string,
  userId: string,
  onNext: (ids: Set<string>) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, `families/${familyId}/announcement_reads`),
      where('userId', '==', userId),
    ),
    snapshot => onNext(new Set(snapshot.docs.map(entry => entry.data().announcementId as string))),
  );
}

export async function createAnnouncement(
  familyId: string,
  input: Omit<FamilyAnnouncement, 'id' | 'familyId' | 'createdBy' | 'createdAt' | 'updatedAt'>,
) {
  const actor = auth.currentUser?.uid;
  if (!actor) throw new Error('Not authenticated');
  return addDoc(collection(db, `families/${familyId}/announcements`), {
    ...input,
    familyId,
    createdBy: actor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateAnnouncement(
  familyId: string,
  announcementId: string,
  updates: Partial<FamilyAnnouncement>,
) {
  const { id: _id, familyId: _familyId, createdBy: _createdBy, createdAt: _createdAt, ...safe } = updates;
  await updateDoc(doc(db, `families/${familyId}/announcements`, announcementId), {
    ...safe,
    updatedAt: serverTimestamp(),
  });
}

export const archiveAnnouncement = (familyId: string, announcementId: string) =>
  updateAnnouncement(familyId, announcementId, { status: 'archived' });

export const deleteAnnouncement = (familyId: string, announcementId: string) =>
  deleteDoc(doc(db, `families/${familyId}/announcements`, announcementId));

export const markAnnouncementRead = (familyId: string, announcementId: string, userId: string) =>
  setDoc(doc(db, `families/${familyId}/announcement_reads`, `${announcementId}_${userId}`), {
    familyId,
    announcementId,
    userId,
    readAt: serverTimestamp(),
  });
