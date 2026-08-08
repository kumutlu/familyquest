import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, path: string) => ({ id: path.split('/').at(-1), path })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
}));

vi.mock('firebase/firestore', () => ({
  doc: firestore.doc,
  runTransaction: firestore.runTransaction,
  serverTimestamp: firestore.serverTimestamp,
}));

vi.mock('./firebase', () => ({ db: { name: 'db' } }));

import { skipDailyCheckin, submitDailyCheckin } from './dailyCheckinsApi';

const checkinRef = { id: 'child-1_2026-08-01', path: 'families/family-1/daily_checkins/child-1_2026-08-01' };
const skipRef = { id: 'child-1_2026-08-01', path: 'families/family-1/daily_checkin_skips/child-1_2026-08-01' };
const missingCheckin = { exists: () => false };
const existingCheckin = { exists: () => true };
const missingSkip = { exists: () => false };
const existingSkip = { exists: () => true };
const input = { familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01', animal: 'cheetah' as const };

describe('daily check-in write API', () => {
  const transaction = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction));
  });

  it('submits V1 check-in and deletes the same-day skip atomically', async () => {
    transaction.get.mockResolvedValueOnce(missingCheckin).mockResolvedValueOnce(existingSkip);

    await expect(submitDailyCheckin(input)).resolves.toEqual({ status: 'written' });

    expect(transaction.set).toHaveBeenCalledWith(checkinRef, expect.objectContaining({
      familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01',
      animal: 'cheetah', catalogVersion: 1,
      createdAt: { sentinel: 'server-timestamp' }, updatedAt: { sentinel: 'server-timestamp' },
    }));
    expect(transaction.delete).toHaveBeenCalledWith(skipRef);
  });

  it('does not create a skip when a valid check-in exists', async () => {
    transaction.get.mockResolvedValue(existingCheckin);

    await expect(skipDailyCheckin({ familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01' }))
      .resolves.toEqual({ status: 'already-checked-in' });

    expect(transaction.set).not.toHaveBeenCalled();
  });

  it('replays an existing matching check-in without duplicate writes', async () => {
    transaction.get.mockResolvedValueOnce(existingCheckin).mockResolvedValueOnce(existingSkip);

    await expect(submitDailyCheckin(input)).resolves.toEqual({ status: 'already-checked-in' });

    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.delete).toHaveBeenCalledWith(skipRef);
  });

  it('creates a deterministic skip when no check-in or skip exists', async () => {
    transaction.get.mockResolvedValueOnce(missingCheckin).mockResolvedValueOnce(missingSkip);

    await expect(skipDailyCheckin({ familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01' }))
      .resolves.toEqual({ status: 'written' });

    expect(transaction.set).toHaveBeenCalledWith(skipRef, {
      familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01',
      createdAt: { sentinel: 'server-timestamp' },
    });
  });

  it('replays an existing skip without duplicate writes', async () => {
    transaction.get.mockResolvedValueOnce(missingCheckin).mockResolvedValueOnce(existingSkip);

    await expect(skipDailyCheckin({ familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01' }))
      .resolves.toEqual({ status: 'already-skipped' });

    expect(transaction.set).not.toHaveBeenCalled();
  });
});
