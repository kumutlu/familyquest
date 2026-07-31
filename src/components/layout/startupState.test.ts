import { describe, it, expect } from 'vitest';
import { deriveStartupPhase } from './startupState';

const base = {
  authStatus: 'authenticated' as const,
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'f1' } as any,
  appReady: true,
  bootstrapError: null as string | null,
};

describe('deriveStartupPhase', () => {
  it('reports the initial authentication check while Firebase Auth is initializing', () => {
    expect(deriveStartupPhase({ ...base, authStatus: 'initializing', authUser: undefined, currentUser: null, appReady: false }))
      .toBe('auth');
  });

  it('reports the profile phase when authenticated but the user document has not arrived', () => {
    expect(deriveStartupPhase({ ...base, currentUser: null, appReady: false })).toBe('profile');
  });

  it('reports the family phase when a profile with a family exists but bootstrap is incomplete', () => {
    expect(deriveStartupPhase({ ...base, appReady: false })).toBe('family');
  });

  it('reports ready once bootstrap completed', () => {
    expect(deriveStartupPhase(base)).toBe('ready');
  });

  it('reports ready for a profile without a family (onboarding takes over)', () => {
    expect(deriveStartupPhase({ ...base, currentUser: { id: 'u1' } as any, appReady: false })).toBe('ready');
  });

  it('reports error whenever a bootstrap error is recorded, regardless of phase', () => {
    expect(deriveStartupPhase({ ...base, appReady: false, bootstrapError: 'boom' })).toBe('error');
    expect(deriveStartupPhase({ ...base, authStatus: 'initializing', bootstrapError: 'boom' })).toBe('error');
  });

  it('reports ready when signed out so the login redirect is never blocked', () => {
    expect(deriveStartupPhase({ ...base, authStatus: 'unauthenticated', authUser: null, currentUser: null, appReady: false }))
      .toBe('ready');
  });
});
