import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// P0 regression: after a family is created successfully the user was bounced
// back to the Create Family screen and a retry failed with "User already has a
// family".
//
// Root cause: the onboarding completion path identified the user through the
// denormalised `currentUser.uid` profile field instead of the authoritative
// identity (auth uid / user document id). `refreshCurrentUser` silently
// no-ops when the uid does not match `authUser.uid`, so the store kept
// `currentUser.familyId === undefined` and AppLayout's guard redirected back
// to /onboarding.
// ---------------------------------------------------------------------------

const apiState = vi.hoisted(() => ({
  createFamilyAndParent: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  createFamilyAndParent: apiState.createFamilyAndParent,
  signOut: vi.fn(),
}));

vi.mock('../lib/familyMembershipApi', () => ({
  requestFamilyJoin: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({}) as any),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, _col, id) => ({ __id: id, type: 'doc' })),
  getDocFromServer: vi.fn(() => Promise.resolve({ exists: () => false })),
  onSnapshot: vi.fn(() => () => {}),
  getFirestore: vi.fn(() => ({}) as any),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocsFromServer: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import { Onboarding } from './Onboarding';
import { useStore } from '../store/useStore';

const loadFamilyData = vi.fn();

const renderOnboarding = () =>
  render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/onboarding'] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/onboarding', element: createElement(Onboarding) }),
        createElement(Route, { path: '/', element: createElement('div', null, 'Parent Dashboard') }),
      ),
    ),
  );

describe('Onboarding — family creation completion (P0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadFamilyData.mockReset();
    useStore.setState({
      authStatus: 'authenticated',
      authInitialized: true,
      authUser: { uid: 'auth-uid-1' } as any,
      // The profile document is the authoritative identity. It intentionally
      // does NOT carry a denormalised `uid` field here.
      currentUser: { id: 'auth-uid-1', displayName: 'Kemal', role: 'parent' } as any,
      loadFamilyData: loadFamilyData as any,
    });
    apiState.createFamilyAndParent.mockResolvedValue({
      familyId: 'family-1',
      inviteCode: 'ABC123',
      user: { id: 'auth-uid-1', familyId: 'family-1', role: 'owner' },
    });
  });

  it('creates the family with the authoritative user id and lands on the dashboard', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(screen.getAllByRole('button')[0]); // "Create family"
    await user.type(screen.getByRole('textbox'), 'Kemal Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(apiState.createFamilyAndParent).toHaveBeenCalledWith(
        'auth-uid-1',
        'Kemal',
        'Kemal Family',
      );
    });

    // Authoritative family state must be applied to the store...
    await waitFor(() => {
      expect(useStore.getState().currentUser?.familyId).toBe('family-1');
    });
    expect(loadFamilyData).toHaveBeenCalledWith('auth-uid-1', 'family-1');

    // ...and the user must never see the Create Family screen again.
    await waitFor(() => {
      expect(screen.getByText('Parent Dashboard')).toBeInTheDocument();
    });
  });
});

describe('useStore.refreshCurrentUser — authoritative family state', () => {
  beforeEach(() => {
    loadFamilyData.mockReset();
    useStore.setState({
      authStatus: 'authenticated',
      authInitialized: true,
      authUser: { uid: 'auth-uid-1' } as any,
      currentUser: { id: 'auth-uid-1', role: 'parent' } as any,
      loadFamilyData: loadFamilyData as any,
    });
  });

  it('applies the family state when called with the profile document id', () => {
    useStore.getState().refreshCurrentUser('auth-uid-1', { familyId: 'family-1', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBe('family-1');
    expect(loadFamilyData).toHaveBeenCalledWith('auth-uid-1', 'family-1');
  });

  it('ignores refreshes for a different user', () => {
    useStore.getState().refreshCurrentUser('someone-else', { familyId: 'family-9', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBeUndefined();
    expect(loadFamilyData).not.toHaveBeenCalled();
  });

  it('never leaves the family state unset when the uid is omitted by a caller', () => {
    useStore.getState().refreshCurrentUser(undefined as any, { familyId: 'family-1', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBe('family-1');
  });
});
