import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ id: parts.at(-1), path: parts.join('/') })),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: firestore.doc,
  setDoc: vi.fn(),
  updateDoc: firestore.updateDoc,
  addDoc: vi.fn(),
  runTransaction: firestore.runTransaction,
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  serverTimestamp: firestore.serverTimestamp,
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./firebase', () => ({
  db: { name: 'db' },
  auth: { currentUser: { uid: 'owner-1' } },
  googleProvider: {},
}));

vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => ['owner-1']),
  getChildIds: vi.fn(async () => []),
  loadNotificationRecipientsInTransaction: vi.fn(async () => ({ ref: {}, data: {} })),
  applyNotificationWrites: vi.fn(),
}));

import { regenerateInviteCode, updateFamilySettings } from './api';

describe('family settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.updateDoc.mockResolvedValue(undefined);
  });

  it('writes only the allowlisted family settings fields and never legacy currency', async () => {
    await updateFamilySettings('family-1', {
      name: 'The Smiths',
      currencyCode: 'TRY',
      timezone: 'Europe/Istanbul',
      weekStartsOn: 1,
      currency: '₺',
      unrelated: true,
    } as any);

    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { id: 'family-1', path: 'families/family-1' },
      {
        name: 'The Smiths',
        currencyCode: 'TRY',
        timezone: 'Europe/Istanbul',
        weekStartsOn: 1,
      },
    );
    expect(firestore.updateDoc.mock.calls[0][1]).not.toHaveProperty('currency');
    expect(firestore.updateDoc.mock.calls[0][1]).not.toHaveProperty('unrelated');
  });

  it.each(['GBP', 'TRY'] as const)('persists the selected canonical currency code %s', async currencyCode => {
    await updateFamilySettings('family-1', { currencyCode });

    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { id: 'family-1', path: 'families/family-1' },
      { currencyCode },
    );
  });

  it('regenerates the invite code in a transaction', async () => {
    const transaction = {
      get: vi.fn(async () => ({ exists: () => true })),
      update: vi.fn(),
    };
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(transaction));

    const result = await regenerateInviteCode('family-1');

    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(transaction.get).toHaveBeenCalledWith({ id: 'family-1', path: 'families/family-1' });
    expect(transaction.update).toHaveBeenCalledWith(
      { id: 'family-1', path: 'families/family-1' },
      { inviteCode: expect.stringMatching(/^[A-Z0-9]{6}$/) },
    );
    expect(result).toEqual({ inviteCode: expect.stringMatching(/^[A-Z0-9]{6}$/) });
  });
});
