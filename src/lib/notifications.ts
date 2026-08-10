import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter as startAfterCursor,
  onSnapshot,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
  type Transaction,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';

// Development-only diagnostics. Never surfaced to users; silenced in production
// so notification-resolution problems can be debugged without leaking internals.
function devLog(context: string, detail: string): void {
  // Silenced in production builds; active in dev and test for diagnostics.
  if (import.meta.env.PROD) return;
  // eslint-disable-next-line no-console
  console.warn(`[notifications:${context}] ${detail}`);
}

// ---------------------------------------------------------------------------
// 1. TYPES
// ---------------------------------------------------------------------------

/**
 * The closed set of notification event types. Each maps to a specific row
 * presentation (icon + copy) and a navigation target in the UI.
 */
export type NotificationType =
  | 'task_submitted'
  | 'task_approved'
  | 'task_rejected'
  | 'reward_requested'
  | 'reward_approved'
  | 'reward_rejected'
  | 'transfer_requested'
  | 'transfer_approved'
  | 'transfer_rejected'
  | 'wallet_deposit'
  | 'wallet_withdrawal'
  | 'behaviour_positive'
  | 'behaviour_negative'
  | 'petbox_contribution'
  | 'petbox_expense'
  | 'profile_update_requested'
  | 'profile_update_approved'
  | 'profile_update_rejected';

export interface NotificationInput {
  type: NotificationType;
  /** Authenticated actor that triggered the event (never "system"). */
  actorId: string;
  /** One or more recipients. Each has independent read state. */
  recipientIds: string[];
  title: string;
  body: string;
  /** Optional entity the notification refers to (task, reward, transfer, ...). */
  entityType?: string;
  entityId?: string;
  /** Route the UI navigates to when the row is clicked. */
  actionUrl?: string;
  /** Stable key used for idempotent de-duplication across retries. */
  dedupeKey?: string;
  /** Optional structured extras (amounts, names, ...). */
  metadata?: Record<string, unknown>;
}

export interface NotificationData extends NotificationInput {
  id: string;
  familyId: string;
  createdAt: unknown;
}

export interface NotificationReadState {
  userId: string;
  notificationId: string;
  readAt: unknown;
}

export const NOTIFICATION_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// 2. PURE BUILDER
// ---------------------------------------------------------------------------

/**
 * Builds the immutable notification document payload. The document id is
 * assigned by the caller (dedupeKey when provided, otherwise an auto id) so it
 * is intentionally NOT part of the payload.
 */
export function buildNotificationData(
  familyId: string,
  input: NotificationInput,
): Omit<NotificationData, 'id'> {
  // NOTE: The client SDK (firebase/firestore) rejects documents that contain
  // `undefined` field values with "Transaction.set() called with invalid data.
  // Unsupported field value: undefined". The Admin SDK silently drops them,
  // which is why this passed under emulator rules tests but failed in the
  // browser. We must therefore OMIT optional fields when they are undefined
  // rather than writing `undefined` explicitly.
  const data: Record<string, unknown> = {
    familyId,
    type: input.type,
    actorId: input.actorId,
    recipientIds: Array.from(new Set(input.recipientIds ?? [])),
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? {},
    createdAt: serverTimestamp(),
  };
  if (input.entityType !== undefined) data.entityType = input.entityType;
  if (input.entityId !== undefined) data.entityId = input.entityId;
  if (input.actionUrl !== undefined) data.actionUrl = input.actionUrl;
  if (input.dedupeKey !== undefined) data.dedupeKey = input.dedupeKey;
  return data as Omit<NotificationData, 'id'>;
}

// ---------------------------------------------------------------------------
// 3. RECIPIENT RESOLUTION
// ---------------------------------------------------------------------------

/**
 * Resolves the set of users (owner + parents) permitted to approve in a family.
 * Used for parent/owner-targeted notifications. Failures are non-fatal: a
 * notification resolution problem must never corrupt the underlying business
 * event, so we return an empty list and let the caller skip the notification.
 */
export async function getApproverIds(familyId: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'users'),
        where('familyId', '==', familyId),
        where('role', 'in', ['owner', 'parent']),
      ),
    );
    // Skip partial / deleted / inactive member docs so a notification is never
    // addressed to a user that cannot receive it.
    return (snap?.docs ?? [])
      .filter(d => {
        const data = d.data() as { role?: string; familyId?: string } | undefined;
        return !!data && typeof data.role === 'string' && data.familyId === familyId;
      })
      .map(d => d.id);
  } catch {
    devLog('getApproverIds', `recipient resolution failed for family ${familyId}; skipping notifications`);
    return [];
  }
}

/**
 * Resolves the set of child member ids in a family. Used for child-targeted
 * notifications such as Pet Box expense updates. Failures are non-fatal.
 */
export async function getChildIds(familyId: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'users'),
        where('familyId', '==', familyId),
        where('role', '==', 'child'),
      ),
    );
    // Skip partial / deleted / inactive member docs so a notification is never
    // addressed to a user that cannot receive it.
    return (snap?.docs ?? [])
      .filter(d => {
        const data = d.data() as { role?: string; familyId?: string } | undefined;
        return !!data && typeof data.role === 'string' && data.familyId === familyId;
      })
      .map(d => d.id);
  } catch {
    devLog('getChildIds', `recipient resolution failed for family ${familyId}; skipping notifications`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 4. ATOMIC QUEUE (used inside runTransaction)
// ---------------------------------------------------------------------------
//
// Firestore transactions require ALL reads to happen before ALL writes. Some
// callers (e.g. submitProfileUpdateRequest) must perform notification writes
// AFTER other writes in the same transaction, which makes the legacy
// read-then-write `queueNotificationInTransaction` illegal. To support that we
// split the helper into an explicit two-stage API:
//
//   Phase A (reads):  loadNotificationRecipientsInTransaction(...)
//   Phase C (writes): applyNotificationWrites(...)
//
// The write stage performs ZERO reads. A convenience wrapper
// `queueNotificationInTransaction` remains for callers that can still do the
// read before any write (it performs the read internally).

export interface NotificationWritePlan {
  /** Document reference to write, or null when the notification should be skipped. */
  ref: ReturnType<typeof doc> | null;
  /** Resolved payload to write, or null when skipped. */
  data: Omit<NotificationData, 'id'> | null;
}

/**
 * Phase A — READ STAGE ONLY.
 *
 * Resolves the notification document reference and decides whether a write is
 * required (skipping when there are no recipients or when a dedupe-keyed
 * notification already exists). Performs the only transaction read the queue
 * needs. Returns a plan consumed by `applyNotificationWrites` (which reads
 * nothing).
 */
export async function loadNotificationRecipientsInTransaction(
  transaction: Transaction,
  familyId: string,
  input: NotificationInput,
): Promise<NotificationWritePlan> {
  const recipientIds = Array.from(new Set(input.recipientIds ?? []));
  if (recipientIds.length === 0) {
    devLog('queue', `skipped notification (${input.type}): no resolvable recipients`);
    return { ref: null, data: null };
  }
  const id = input.dedupeKey || doc(collection(db, `families/${familyId}/notifications`)).id;
  const ref = doc(db, `families/${familyId}/notifications`, id);
  const existing = await transaction.get(ref);
  if (existing.exists()) {
    devLog('queue', `dedupe skip (${input.type}): ${id} already exists`);
    return { ref: null, data: null }; // idempotent de-duplication
  }
  return { ref, data: buildNotificationData(familyId, { ...input, recipientIds }) };
}

/**
 * Phase C — WRITE STAGE ONLY (performs ZERO reads).
 *
 * Applies a plan produced by `loadNotificationRecipientsInTransaction`. Safe to
 * call after other writes in the same transaction.
 */
export function applyNotificationWrites(
  transaction: Transaction,
  plan: NotificationWritePlan,
): void {
  if (plan.ref && plan.data) {
    transaction.set(plan.ref, plan.data);
  }
}

/**
 * Convenience wrapper for callers that can still perform the read before any
 * write in their transaction. Internally does read-then-write; do NOT use this
 * after another write has already occurred in the same transaction.
 *
 * @deprecated Prefer the explicit loadNotificationRecipientsInTransaction +
 * applyNotificationWrites split when writes already happened earlier.
 */
export async function queueNotificationInTransaction(
  transaction: Transaction,
  familyId: string,
  input: NotificationInput,
): Promise<void> {
  const plan = await loadNotificationRecipientsInTransaction(transaction, familyId, input);
  applyNotificationWrites(transaction, plan);
}

// ---------------------------------------------------------------------------
// 5. READ STATE
// ---------------------------------------------------------------------------

function readStateRef(familyId: string, userId: string, notificationId: string) {
  return doc(db, `families/${familyId}/notification_reads`, `${userId}_${notificationId}`);
}

/** Marks a single notification as read for the authenticated user. */
export async function markNotificationRead(
  familyId: string,
  userId: string,
  notificationId: string,
): Promise<void> {
  const ref = readStateRef(familyId, userId, notificationId);
  await setDoc(ref, { familyId, userId, notificationId, readAt: serverTimestamp() });
}

/**
 * Maximum number of read records written per Firestore batch when marking
 * notifications read.
 *
 * Root cause of the production failure: the `notification_reads` create rule
 * (see firestore.rules) performs a `get()` on the parent notification document
 * for every write it evaluates. Firestore security rules enforce a hard limit of
 * 20 document accesses (get/exists) per request. A single `writeBatch().commit()`
 * of 20+ read records therefore triggers 20+ distinct document accesses (one
 * cached family doc + one per distinct notification) and the entire batch is
 * rejected with `permission-denied`.
 *
 * Committing in chunks keeps each request's rule-evaluation document accesses at
 * or below the limit: with this size each commit touches at most
 * 1 (family, cached) + 15 (distinct notifications) = 16 accesses, leaving
 * headroom for the rule's other reads and any future rule additions. We must not
 * raise this above 15 without re-validating the rules document-access budget.
 */
export const MARK_ALL_READ_CHUNK_SIZE = 15;

/** Marks many notifications as read for the authenticated user (batched). */
export async function markAllNotificationsRead(
  familyId: string,
  userId: string,
  notificationIds: string[],
  alreadyRead: Set<string> = new Set(),
): Promise<void> {
  // Skip notifications the user has already read so we never re-write (and
  // never risk a misleading success state for) read rows. This also makes the
  // operation idempotent across retries after a partial failure: a retry can
  // pass the updated readIds set and only the still-unread rows are written.
  const ids = notificationIds.filter(Boolean).filter(id => !alreadyRead.has(id));
  if (ids.length === 0) return;

  // Commit in safe chunks so each writeBatch().commit() stays within the
  // Firestore rules per-request document access limit (see
  // MARK_ALL_READ_CHUNK_SIZE). Each chunk is an independent atomic commit.
  for (let i = 0; i < ids.length; i += MARK_ALL_READ_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + MARK_ALL_READ_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const nid of chunk) {
      batch.set(readStateRef(familyId, userId, nid), {
        familyId,
        userId,
        notificationId: nid,
        readAt: serverTimestamp(),
      });
    }
    // writeBatch.commit() is atomic: either every write in the chunk succeeds
    // or the whole chunk is rejected. On rejection it throws, so we propagate
    // the error rather than report success. Already-committed chunks remain
    // written (idempotent doc ids `userId_notificationId` + the caller's
    // readIds set guarantee no duplicates and that all notifications are
    // eventually marked read on retry).
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// 6. REALTIME SUBSCRIPTIONS
// ---------------------------------------------------------------------------

export interface NotificationsSubscriptionOptions {
  onNext: (notifications: NotificationData[]) => void;
  onError: (error: unknown) => void;
  pageSize?: number;
}

/**
 * Realtime listener for the latest notifications visible to `userId`.
 * Bounded to `pageSize` (default 20) to avoid an unbounded listener.
 */
export function subscribeToNotifications(
  familyId: string,
  userId: string,
  { onNext, onError, pageSize = NOTIFICATION_PAGE_SIZE }: NotificationsSubscriptionOptions,
): () => void {
  const q = query(
    collection(db, `families/${familyId}/notifications`),
    where('recipientIds', 'array-contains', userId),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(
    q,
    snapshot => onNext(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as DocumentData) } as NotificationData))),
    onError,
  );
}

export interface ReadStatesSubscriptionOptions {
  onNext: (readNotificationIds: Set<string>) => void;
  onError: (error: unknown) => void;
}

/** Realtime listener for the set of notification ids the user has read. */
export function subscribeToReadStates(
  familyId: string,
  userId: string,
  { onNext, onError }: ReadStatesSubscriptionOptions,
): () => void {
  const q = query(
    collection(db, `families/${familyId}/notification_reads`),
    where('userId', '==', userId),
  );
  return onSnapshot(
    q,
    snapshot => onNext(new Set(snapshot.docs.map(d => (d.data() as DocumentData).notificationId as string))),
    onError,
  );
}

/**
 * One-shot fetch of an older page for "Load more". Uses a cursor on
 * `createdAt` so it never overlaps the realtime latest-20 listener.
 */
export async function fetchNotificationsPage(
  familyId: string,
  userId: string,
  options: { pageSize?: number; startAfter?: unknown } = {},
): Promise<NotificationData[]> {
  const { pageSize = NOTIFICATION_PAGE_SIZE, startAfter } = options;
  const constraints: QueryConstraint[] = [
    where('recipientIds', 'array-contains', userId),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  ];
  if (startAfter != null) constraints.push(startAfterCursor(startAfter as never));
  const q = query(collection(db, `families/${familyId}/notifications`), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as DocumentData) } as NotificationData));
}

// ---------------------------------------------------------------------------
// 7. FRIENDLY ERROR MAPPING
// ---------------------------------------------------------------------------

export const NOTIFICATION_LOAD_ERROR = "We couldn't load notifications. Please try again.";
export const NOTIFICATION_READ_ERROR = "We couldn't update this notification.";

// ---------------------------------------------------------------------------
// 7b. SAFE RENDERING HELPERS (malformed / legacy record tolerance)
// ---------------------------------------------------------------------------
//
// Production notifications may be missing optional fields (body, actionUrl,
// entityId, metadata) or carry an unknown `type` from a future/legacy client.
// These helpers guarantee the UI always has a safe, non-empty value to render
// so a single malformed row can never crash the whole panel.

export const NOTIFICATION_FALLBACK_TITLE = 'Notification';
export const NOTIFICATION_FALLBACK_BODY = 'You have a new update.';

/** Returns a non-empty title, falling back to a generic label when missing. */
export function getNotificationTitle(n: Partial<NotificationData> | null | undefined): string {
  if (n && typeof n.title === 'string' && n.title.trim().length > 0) return n.title;
  return NOTIFICATION_FALLBACK_TITLE;
}

/** Returns a non-empty body, falling back to a generic label when missing. */
export function getNotificationBody(n: Partial<NotificationData> | null | undefined): string {
  if (n && typeof n.body === 'string' && n.body.trim().length > 0) return n.body;
  return NOTIFICATION_FALLBACK_BODY;
}

/** True when the notification has a usable (non-empty) body. */
export function hasNotificationBody(n: Partial<NotificationData> | null | undefined): boolean {
  return !!(n && typeof n.body === 'string' && n.body.trim().length > 0);
}

/** Maps raw Firebase / unknown errors to user-safe copy. */
export function mapNotificationError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'permission-denied':
      return NOTIFICATION_READ_ERROR;
    case 'unavailable':
    case 'deadline-exceeded':
      return NOTIFICATION_LOAD_ERROR;
    default:
      return NOTIFICATION_LOAD_ERROR;
  }
}

// ---------------------------------------------------------------------------
// 8. RELATIVE TIME FORMATTING (pure, testable)
// ---------------------------------------------------------------------------

export function toMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof (value as { seconds?: number }).seconds === 'number') {
    const v = value as { seconds: number; nanoseconds?: number };
    return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1_000_000);
  }
  return 0;
}

/** Returns a short human relative time, e.g. "just now", "5m", "3h", "2d". */
export function formatRelativeTime(value: unknown, now: number = Date.now()): string {
  const time = toMillis(value);
  if (!time) return 'just now';
  const diff = now - time;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(day / 365)}y`;
}
