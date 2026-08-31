import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
}));
const firestoreMocks = vi.hoisted(() => ({
  setDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

vi.mock('firebase/auth', () => ({
  ...authMocks,
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  ...firestoreMocks,
  collection: vi.fn(), updateDoc: vi.fn(), addDoc: vi.fn(), runTransaction: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(),
  deleteDoc: vi.fn(), deleteField: vi.fn(), writeBatch: vi.fn(),
}));
vi.mock('./firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('./notifications', () => ({
  loadNotificationRecipientsInTransaction: vi.fn(), applyNotificationWrites: vi.fn(),
  getApproverIds: vi.fn(), getChildIds: vi.fn(), getActiveFamilyMembers: vi.fn(),
}));

import { signUp } from './api';

describe('password signup verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes the email, creates only the pending profile, and sends the production action URL', async () => {
    const user = { uid: 'new-user' };
    authMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
    await signUp(' Parent@Example.COM ', 'secure-password', 'Parent');

    expect(authMocks.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(), 'parent@example.com', 'secure-password',
    );
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/new-user' }),
      expect.not.objectContaining({ familyId: expect.anything() }),
    );
    expect(authMocks.sendEmailVerification).toHaveBeenCalledWith(user, {
      url: 'https://queki.app/verify-email',
      handleCodeInApp: false,
    });
  });
});
