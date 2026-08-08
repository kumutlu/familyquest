import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const collection = vi.fn((_db: unknown, path: string) => ({ path }));
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') };
    return { id: 'gen', path: `${first?.path ?? 'db'}/gen` };
  });
  return {
    collection,
    doc,
    serverTimestamp: vi.fn(() => ({ server: true })),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
    onSnapshot: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
  };
});

vi.mock('firebase/firestore', () => ({ ...firestore }));
vi.mock('./firebase', () => ({ db: { name: 'db' } }));

import {
  buildNotificationData,
  formatRelativeTime,
  toMillis,
  mapNotificationError,
  queueNotificationInTransaction,
  loadNotificationRecipientsInTransaction,
  applyNotificationWrites,
  getApproverIds,
  getChildIds,
  getNotificationTitle,
  getNotificationBody,
  markNotificationRead,
  markAllNotificationsRead,
  MARK_ALL_READ_CHUNK_SIZE,
  NOTIFICATION_FALLBACK_TITLE,
  NOTIFICATION_FALLBACK_BODY,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_LOAD_ERROR,
  NOTIFICATION_READ_ERROR,
  subscribeToNotifications,
} from './notifications';

describe('buildNotificationData', () => {
  it('builds the immutable payload with the supplied fields', () => {
    const data = buildNotificationData('fam1', {
      type: 'task_submitted',
      actorId: 'u1',
      recipientIds: ['u2', 'u3'],
      title: 'Muhammed completed a task',
      body: 'Review “Clean bedroom”',
      entityType: 'task_completion',
      entityId: 'c1',
      actionUrl: '/',
      dedupeKey: 'task_submit_c1',
      metadata: { a: 1 },
    });
    expect(data.familyId).toBe('fam1');
    expect(data.type).toBe('task_submitted');
    expect(data.actorId).toBe('u1');
    expect(data.recipientIds).toEqual(['u2', 'u3']);
    expect(data.title).toBe('Muhammed completed a task');
    expect(data.body).toBe('Review “Clean bedroom”');
    expect(data.entityType).toBe('task_completion');
    expect(data.entityId).toBe('c1');
    expect(data.actionUrl).toBe('/');
    expect(data.dedupeKey).toBe('task_submit_c1');
    expect(data.metadata).toEqual({ a: 1 });
    expect(data.createdAt).toEqual({ server: true });
  });

  it('defaults optional fields to undefined', () => {
    const data = buildNotificationData('fam1', {
      type: 'task_approved',
      actorId: 'u1',
      recipientIds: ['u2'],
      title: 'Task approved',
      body: 'body',
    });
    expect(data.entityType).toBeUndefined();
    expect(data.entityId).toBeUndefined();
    expect(data.actionUrl).toBeUndefined();
    expect(data.dedupeKey).toBeUndefined();
    expect(data.metadata).toEqual({});
  });
});

describe('toMillis', () => {
  it('handles Firestore Timestamp, Date, number and {seconds}', () => {
    expect(toMillis({ toMillis: () => 123 })).toBe(123);
    expect(toMillis(new Date(1000))).toBe(1000);
    expect(toMillis(2000)).toBe(2000);
    expect(toMillis({ seconds: 2, nanoseconds: 0 })).toBe(2000);
    expect(toMillis(null)).toBe(0);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  it('returns just now for very recent', () => {
    expect(formatRelativeTime(now, now)).toBe('just now');
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
  });
  it('formats minutes, hours, days', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d');
  });
});

describe('mapNotificationError', () => {
  it('maps permission-denied to the read error', () => {
    expect(mapNotificationError({ code: 'permission-denied' })).toBe(NOTIFICATION_READ_ERROR);
  });
  it('maps unavailable to the load error', () => {
    expect(mapNotificationError({ code: 'unavailable' })).toBe(NOTIFICATION_LOAD_ERROR);
  });
  it('defaults to the load error', () => {
    expect(mapNotificationError(new Error('boom'))).toBe(NOTIFICATION_LOAD_ERROR);
  });
});

describe('queueNotificationInTransaction', () => {
  it('skips the write when there are no recipients', async () => {
    const tx = { get: vi.fn(async () => ({ exists: () => false })), set: vi.fn() };
    await queueNotificationInTransaction(tx as any, 'fam1', {
      type: 'task_approved',
      actorId: 'u1',
      recipientIds: [],
      title: 't',
      body: 'b',
    });
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('writes a notification when recipients exist and it is new', async () => {
    const tx = { get: vi.fn(async () => ({ exists: () => false })), set: vi.fn() };
    await queueNotificationInTransaction(tx as any, 'fam1', {
      type: 'task_approved',
      actorId: 'u1',
      recipientIds: ['u2'],
      title: 'Task approved',
      body: 'b',
      dedupeKey: 'task_approve_c1',
    });
    expect(tx.get).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledTimes(1);
    const written = tx.set.mock.calls[0][1];
    expect(written.recipientIds).toEqual(['u2']);
    expect(written.title).toBe('Task approved');
  });

  it('de-duplicates when the same dedupeKey already exists', async () => {
    const tx = {
      get: vi.fn(async () => ({ exists: () => true, data: () => ({}) })),
      set: vi.fn(),
    };
    await queueNotificationInTransaction(tx as any, 'fam1', {
      type: 'task_approved',
      actorId: 'u1',
      recipientIds: ['u2'],
      title: 'Task approved',
      body: 'b',
      dedupeKey: 'task_approve_c1',
    });
    expect(tx.set).not.toHaveBeenCalled();
  });
});

describe('loadNotificationRecipientsInTransaction / applyNotificationWrites (split stages)', () => {
  const input = {
    type: 'task_approved' as const,
    actorId: 'u1',
    recipientIds: ['u2'],
    title: 'Task approved',
    body: 'b',
    dedupeKey: 'task_approve_c1',
  };

  it('read stage performs exactly one get and returns a write plan', async () => {
    const tx = { get: vi.fn(async () => ({ exists: () => false })), set: vi.fn() };
    const plan = await loadNotificationRecipientsInTransaction(tx as any, 'fam1', input);
    expect(tx.get).toHaveBeenCalledTimes(1);
    expect(plan.ref).not.toBeNull();
    expect(plan.data).not.toBeNull();
    expect(plan.data?.recipientIds).toEqual(['u2']);
  });

  it('read stage skips the plan when there are no recipients', async () => {
    const tx = { get: vi.fn(async () => ({ exists: () => false })), set: vi.fn() };
    const plan = await loadNotificationRecipientsInTransaction(tx as any, 'fam1', { ...input, recipientIds: [] });
    expect(plan.ref).toBeNull();
    expect(plan.data).toBeNull();
  });

  it('read stage de-dupes when the notification already exists', async () => {
    const tx = { get: vi.fn(async () => ({ exists: () => true, data: () => ({}) })), set: vi.fn() };
    const plan = await loadNotificationRecipientsInTransaction(tx as any, 'fam1', input);
    expect(plan.ref).toBeNull();
    expect(plan.data).toBeNull();
  });

  it('write stage performs zero reads and applies the plan', () => {
    const tx = { get: vi.fn(), set: vi.fn() };
    const ref = { path: 'families/fam1/notifications/task_approve_c1' } as any;
    applyNotificationWrites(tx as any, { ref, data: { familyId: 'fam1' } as any });
    expect(tx.get).not.toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledTimes(1);
  });

  it('write stage is a no-op for a skipped plan', () => {
    const tx = { get: vi.fn(), set: vi.fn() };
    applyNotificationWrites(tx as any, { ref: null, data: null });
    expect(tx.set).not.toHaveBeenCalled();
  });
});

describe('recipient resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getApproverIds returns [] when the query fails (non-fatal)', async () => {
    firestore.getDocs.mockImplementation(() => {
      throw new Error('network');
    });
    expect(await getApproverIds('fam1')).toEqual([]);
  });

  it('getApproverIds maps docs to ids', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        { id: 'owner1', data: () => ({ role: 'owner', familyId: 'fam1' }) },
        { id: 'parent1', data: () => ({ role: 'parent', familyId: 'fam1' }) },
      ],
    });
    expect(await getApproverIds('fam1')).toEqual(['owner1', 'parent1']);
  });

  it('getChildIds maps docs to ids', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        { id: 'child1', data: () => ({ role: 'child', familyId: 'fam1' }) },
        { id: 'child2', data: () => ({ role: 'child', familyId: 'fam1' }) },
      ],
    });
    expect(await getChildIds('fam1')).toEqual(['child1', 'child2']);
  });
});

describe('safe rendering helpers', () => {
  it('getNotificationTitle falls back when missing or blank', () => {
    expect(getNotificationTitle(null)).toBe(NOTIFICATION_FALLBACK_TITLE);
    expect(getNotificationTitle(undefined)).toBe(NOTIFICATION_FALLBACK_TITLE);
    expect(getNotificationTitle({})).toBe(NOTIFICATION_FALLBACK_TITLE);
    expect(getNotificationTitle({ title: '   ' })).toBe(NOTIFICATION_FALLBACK_TITLE);
    expect(getNotificationTitle({ title: 'Hi' })).toBe('Hi');
  });

  it('getNotificationBody falls back when missing or blank', () => {
    expect(getNotificationBody(undefined)).toBe(NOTIFICATION_FALLBACK_BODY);
    expect(getNotificationBody({})).toBe(NOTIFICATION_FALLBACK_BODY);
    expect(getNotificationBody({ body: '' })).toBe(NOTIFICATION_FALLBACK_BODY);
    expect(getNotificationBody({ body: 'Detail' })).toBe('Detail');
  });
});

describe('buildNotificationData', () => {
  it('de-duplicates recipient ids', () => {
    const data = buildNotificationData('fam1', {
      type: 'task_approved',
      actorId: 'u1',
      recipientIds: ['a', 'a', 'b'],
      title: 't',
      body: 'b',
    });
    expect(data.recipientIds).toEqual(['a', 'b']);
  });
});

describe('recipient resolution skips invalid members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getApproverIds skips docs without a valid role or familyId', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        { id: 'owner1', data: () => ({ role: 'owner', familyId: 'fam1' }) },
        { id: 'ghost', data: () => ({ role: 'owner' }) }, // missing familyId
        { id: 'wrong', data: () => ({ role: 'owner', familyId: 'other' }) }, // wrong family
        { id: 'partial', data: () => ({ familyId: 'fam1' }) }, // missing role
      ],
    });
    expect(await getApproverIds('fam1')).toEqual(['owner1']);
  });

  it('getChildIds skips docs without a valid role or familyId', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        { id: 'child1', data: () => ({ role: 'child', familyId: 'fam1' }) },
        { id: 'deleted', data: () => ({ role: 'child' }) }, // missing familyId
      ],
    });
    expect(await getChildIds('fam1')).toEqual(['child1']);
  });
});

describe('realtime listener bounds', () => {
  it('subscribes to the latest 20 filtered by recipient', () => {
    subscribeToNotifications('fam1', 'u1', { onNext: vi.fn(), onError: vi.fn() });
    expect(firestore.where).toHaveBeenCalledWith('recipientIds', 'array-contains', 'u1');
    expect(firestore.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(firestore.limit).toHaveBeenCalledWith(NOTIFICATION_PAGE_SIZE);
  });
});

describe('mark read (read-state writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('markNotificationRead writes the user own read record with a server timestamp', async () => {
    await markNotificationRead('fam1', 'u1', 'n1');
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = firestore.setDoc.mock.calls[0];
    expect(ref.path).toBe('families/fam1/notification_reads/u1_n1');
    expect(data).toEqual({
      familyId: 'fam1',
      userId: 'u1',
      notificationId: 'n1',
      readAt: { server: true },
    });
  });

  it('markAllNotificationsRead writes one read record per own unread notification', async () => {
    const batch = { set: vi.fn(), commit: vi.fn(async () => {}) };
    firestore.writeBatch.mockReturnValue(batch as any);
    await markAllNotificationsRead('fam1', 'u1', ['n1', 'n2', 'n3']);
    expect(batch.set).toHaveBeenCalledTimes(3);
    expect(batch.commit).toHaveBeenCalledTimes(1);
    const paths = batch.set.mock.calls.map(c => c[0].path);
    expect(paths).toEqual([
      'families/fam1/notification_reads/u1_n1',
      'families/fam1/notification_reads/u1_n2',
      'families/fam1/notification_reads/u1_n3',
    ]);
  });

  it('markAllNotificationsRead skips already-read notifications', async () => {
    const batch = { set: vi.fn(), commit: vi.fn(async () => {}) };
    firestore.writeBatch.mockReturnValue(batch as any);
    await markAllNotificationsRead('fam1', 'u1', ['n1', 'n2'], new Set(['n2']));
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.set.mock.calls[0][0].path).toBe('families/fam1/notification_reads/u1_n1');
  });

  it('markAllNotificationsRead is a no-op when every notification is already read', async () => {
    const batch = { set: vi.fn(), commit: vi.fn(async () => {}) };
    firestore.writeBatch.mockReturnValue(batch as any);
    await markAllNotificationsRead('fam1', 'u1', ['n1'], new Set(['n1']));
    expect(batch.set).not.toHaveBeenCalled();
    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('markAllNotificationsRead throws when the batch commit fails (no misleading success)', async () => {
    const batch = { set: vi.fn(), commit: vi.fn(async () => { throw new Error('permission-denied'); }) };
    firestore.writeBatch.mockReturnValue(batch as any);
    await expect(markAllNotificationsRead('fam1', 'u1', ['n1'])).rejects.toThrow();
  });
});

describe('markAllNotificationsRead chunking (regression for rules document-access limit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset writeBatch so a lingering mockReturnValue (e.g. a throwing batch
    // from the "throws on failure" test above) cannot leak into these tests.
    firestore.writeBatch.mockReset();
    firestore.writeBatch.mockImplementation(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) }));
  });

  it('commits 20+ unread notifications in safe chunks of at most MARK_ALL_READ_CHUNK_SIZE', async () => {
    // Reproduces the production scenario: a user with 25 unread notifications.
    // The old single-batch implementation would issue one writeBatch().commit()
    // with 25 sets and be rejected by the Firestore rules 20-document-access
    // limit. The new implementation must split into multiple commits so each
    // stays under the limit. (The actual rules-limit rejection is asserted in
    // tests/firestore/notifications.rules.test.ts.)
    const ids = Array.from({ length: 25 }, (_, i) => `n${i}`);
    await markAllNotificationsRead('fam1', 'u1', ids);

    // 25 notifications with chunk size 15 => 2 batches (15 + 10).
    expect(firestore.writeBatch).toHaveBeenCalledTimes(2);
    const batches = firestore.writeBatch.mock.results.map(r => r.value as any);
    expect(batches[0].set).toHaveBeenCalledTimes(MARK_ALL_READ_CHUNK_SIZE);
    expect(batches[1].set).toHaveBeenCalledTimes(25 - MARK_ALL_READ_CHUNK_SIZE);
    expect(batches[0].commit).toHaveBeenCalledTimes(1);
    expect(batches[1].commit).toHaveBeenCalledTimes(1);

    // Every notification is eventually written (all marked read), with no
    // duplicates.
    const writtenPaths = batches.flatMap(b => b.set.mock.calls.map((c: any) => c[0].path));
    expect(writtenPaths).toHaveLength(25);
    expect(new Set(writtenPaths).size).toBe(25);
    for (let i = 0; i < 25; i++) {
      expect(writtenPaths).toContain(`families/fam1/notification_reads/u1_n${i}`);
    }
  });

  it('still skips already-read notifications when chunking across boundaries', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const already = new Set(['n0', 'n14', 'n19']); // spread across chunk boundaries
    await markAllNotificationsRead('fam1', 'u1', ids, already);
    const batches = firestore.writeBatch.mock.results.map(r => r.value as any);
    const written = batches.flatMap(b => b.set.mock.calls.map((c: any) => c[0].path));
    expect(written).toHaveLength(17);
    expect(written).not.toContain('families/fam1/notification_reads/u1_n0');
    expect(written).not.toContain('families/fam1/notification_reads/u1_n14');
    expect(written).not.toContain('families/fam1/notification_reads/u1_n19');
  });

  it('throws on a chunk commit failure (no misleading success) and preserves idempotent retry', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const original = firestore.writeBatch.getMockImplementation();
    let call = 0;
    firestore.writeBatch.mockImplementation(() => {
      const idx = call++;
      return {
        set: vi.fn(),
        commit: vi.fn(async () => {
          if (idx === 1) throw new Error('permission-denied');
        }),
      } as any;
    });
    try {
      await expect(markAllNotificationsRead('fam1', 'u1', ids)).rejects.toThrow();
    } finally {
      firestore.writeBatch.mockImplementation(original!);
    }
  });
});
