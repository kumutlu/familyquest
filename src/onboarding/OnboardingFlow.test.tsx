import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import i18n from '../i18n/config';
import { clearCreateFamilyIntent, readCreateFamilyIntent, startCreateFamilyIntent } from '../auth/createFamilyIntent';
import { useStore } from '../store/useStore';
import { clearDraft, saveDraft } from './lib/onboardingDraft';

const navigate = vi.fn();
const api = vi.hoisted(() => ({
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  createFamilyAndParent: vi.fn(),
  createManagedMember: vi.fn().mockResolvedValue('child-1'),
  createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
}));
const adultInvitationApi = vi.hoisted(() => ({
  createAdultInvitation: vi.fn(),
  revokeAdultInvitation: vi.fn(),
}));

vi.mock('../lib/api', () => api);
vi.mock('../lib/adultInvitationApi', () => adultInvitationApi);

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, _col: string, id?: string) => ({ __id: id })),
  getDocFromServer: vi.fn(() => Promise.resolve({ exists: () => false })),
  onSnapshot: vi.fn(() => () => {}),
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocsFromServer: vi.fn(() => Promise.resolve({ docs: [] })),
}));

// Keep real routing primitives, but capture programmatic navigation and turn
// <Navigate> into an observable marker so we can assert redirects.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigate,
    Navigate: ({ to }: { to: string }) => createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
  };
});

import { OnboardingFlow } from './OnboardingFlow';

function renderFlow(initialEntry = '/onboarding') {
  return render(
    createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(OnboardingFlow)),
  );
}

async function setStore(partial: Record<string, unknown>) {
  await act(async () => {
    useStore.setState(partial as never);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  clearCreateFamilyIntent();
  api.createFamilyAndParent.mockResolvedValue({
    familyId: 'family-1',
    inviteCode: 'ABC123',
    user: { id: 'auth-uid-1', familyId: 'family-1', role: 'owner' },
  });
  adultInvitationApi.createAdultInvitation.mockResolvedValue({
    invitationId: 'a'.repeat(64),
    token: 'adult-token',
    intendedRole: 'parent',
    expiresAt: '2026-09-02T12:00:00.000Z',
  });
  await setStore({
    authStatus: 'unauthenticated',
    authUser: null,
    currentUser: null,
    bootstrapError: null,
    familyMembers: [],
    familyData: null,
    profileServerConfirmed: true,
  });
  await i18n.loadNamespaces(['onboarding', 'common']);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('OnboardingFlow — public route & guards', () => {
  it('renders Step 1 for an unauthenticated visitor', () => {
    renderFlow();
    expect(screen.getByRole('button', { name: /set up your family/i })).toBeInTheDocument();
  });

  it('redirects an established family owner away from onboarding', async () => {
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'owner', familyId: 'family-x' },
    });
    renderFlow();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/');
  });

  it('redirects a managed child away from the parent flow', async () => {
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'child-1' },
      currentUser: { id: 'child-1', role: 'child', isManaged: true, familyId: 'family-x' },
    });
    renderFlow();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/');
  });

  it('does NOT offer Apple sign-in (only Google + Email)', async () => {
    // Walk to S7.
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('button', { name: /set up your family/i }));
    await user.type(screen.getByLabelText(/your first name/i), 'Kemal');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('radio', { name: 'Parent' }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText(/child's first name/i), 'Osman');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /looks good/i }));
    await user.type(screen.getByLabelText(/family name/i), 'Kemal Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument();
  });
});

describe('OnboardingFlow — post-auth idempotent setup', () => {
  it('routes Google auth with a stale p1 draft to /no-family and performs zero writes without an intent', async () => {
    saveDraft({
      version: 1,
      step: 'p1',
      parentFirstName: 'Kemal',
      parentRoleDisplay: 'parent',
      childFirstName: 'Osman',
      familyName: 'Accidental',
      updatedAt: Date.now(),
    });
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'auth-uid-1' },
      currentUser: { id: 'auth-uid-1', role: 'parent' },
      profileServerConfirmed: true,
    });

    renderFlow('/onboarding?mode=create');

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/no-family');
    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
    expect(api.createManagedMember).not.toHaveBeenCalled();
  });

  it('creates the family, first child and first task exactly once, then finishes', async () => {
    const user = userEvent.setup();
    renderFlow('/onboarding?mode=create');

    // Pre-auth walk to S7.
    await user.click(screen.getByRole('button', { name: /set up your family/i }));
    await user.type(screen.getByLabelText(/your first name/i), 'Kemal');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('radio', { name: 'Parent' }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByLabelText(/child's first name/i), 'Osman');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /looks good/i }));
    await user.type(screen.getByLabelText(/family name/i), 'Kemal Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Trigger Google auth, then simulate auth completion.
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(api.signInWithGoogle).toHaveBeenCalledTimes(1);

    startCreateFamilyIntent('auth-uid-1');
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'auth-uid-1' },
      currentUser: { id: 'auth-uid-1', role: 'parent' },
      profileServerConfirmed: true,
    });

    // P1 auto-creates the family + first child.
    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(1));
    expect(api.createFamilyAndParent).toHaveBeenCalledWith('auth-uid-1', 'Kemal', 'Kemal Family');
    await waitFor(() => expect(api.createManagedMember).toHaveBeenCalledTimes(1));
    expect(readCreateFamilyIntent('auth-uid-1')).not.toBeNull();

    // Continue to P2.
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('radio', { name: /tidy bedroom/i }));
    await user.click(screen.getByRole('button', { name: /add task & continue/i }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    expect(api.createTask).toHaveBeenCalledWith(
      'family-1',
      expect.objectContaining({ title: 'Tidy bedroom', assigneeId: 'child-1' }),
      expect.objectContaining({ clientReqId: expect.any(String) }),
    );

    // P3 → dashboard.
    await waitFor(() => expect(screen.getByRole('button', { name: /go to my dashboard/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /go to my dashboard/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(readCreateFamilyIntent('auth-uid-1')).toBeNull();
    // Draft cleared on completion.
    expect(useStore.getState().currentUser?.familyId).toBe('family-1');
  });

  it('does not recreate the family when the draft already holds a familyId (refresh/resume)', async () => {
    // Simulate a draft left over from a previous session that already created the family.
    saveDraft({
      version: 1,
      step: 'p1',
      parentFirstName: 'Kemal',
      parentRoleDisplay: 'parent',
      childFirstName: 'Osman',
      familyName: 'Kemal Family',
      familyId: 'family-1',
      childId: 'child-1',
      updatedAt: Date.now(),
    });

    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'auth-uid-1' },
      currentUser: { id: 'auth-uid-1', role: 'parent' },
      profileServerConfirmed: true,
    });

    startCreateFamilyIntent('auth-uid-1');
    renderFlow('/onboarding?mode=create');
    // P1 mounts; ensureFamily must skip because familyId is already present.
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument());
    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
  });

  it('uses the private adult invitation primitive from family composition', async () => {
    saveDraft({
      version: 1,
      step: 'p1',
      parentFirstName: 'Kemal',
      parentRoleDisplay: 'parent',
      childFirstName: 'Osman',
      familyName: 'Kemal Family',
      familyId: 'family-1',
      childId: 'child-1',
      updatedAt: Date.now(),
    });
    startCreateFamilyIntent('auth-uid-1');
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'auth-uid-1' },
      currentUser: { id: 'auth-uid-1', role: 'owner' },
      familyData: { id: 'family-1', inviteCode: 'ABC123' },
      profileServerConfirmed: true,
    });

    const user = userEvent.setup();
    renderFlow('/onboarding?mode=create');
    await user.click(await screen.findByRole('button', { name: /invite another parent/i }));
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    expect(adultInvitationApi.createAdultInvitation).toHaveBeenCalledWith({
      intendedRole: 'parent',
      clientReqId: expect.any(String),
    });
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
  });
});

describe('OnboardingFlow — Step 1 (Refined Queki front door)', () => {
  it('renders the Refined Queki Step 1 value proposition', () => {
    renderFlow();
    expect(screen.getByRole('heading', { name: /small wins\. big habits\./i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up your family/i })).toBeInTheDocument();
  });

  it('offers an "I already have an account" escape hatch to /login', async () => {
    const user = userEvent.setup();
    renderFlow();

    const loginLink = screen.getByRole('button', { name: /i already have an account/i });
    await user.click(loginLink);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
  });

  it('offers the existing manual join-family route as a secondary welcome action', async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole('button', { name: /join a family/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/join-family'));
  });
});

describe('OnboardingFlow — Sign out (S2 control)', () => {
  it('signs out via Firebase and returns to /login (replace), so it is not a no-op', async () => {
    const user = userEvent.setup();
    renderFlow();

    // Advance to Step 2, where the Sign out control lives.
    await user.click(screen.getByRole('button', { name: /set up your family/i }));
    const signOutButton = await screen.findByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    // 1) The canonical Firebase sign-out path is actually executed.
    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    // 2) The user leaves onboarding and lands on the signed-out entry
    //    experience. `replace` prevents Back from silently restoring the
    //    authenticated onboarding session.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('does not strand the user if sign-out fails — still returns to /login', async () => {
    const user = userEvent.setup();
    api.signOut.mockRejectedValueOnce(new Error('network'));
    renderFlow();
    await user.click(screen.getByRole('button', { name: /set up your family/i }));
    const signOutButton = await screen.findByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('clears a create-family intent before signing out', async () => {
    const user = userEvent.setup();
    startCreateFamilyIntent('auth-uid-1');
    renderFlow();

    await user.click(screen.getByRole('button', { name: /set up your family/i }));
    await user.click(await screen.findByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(api.signOut).toHaveBeenCalledTimes(1));
    expect(readCreateFamilyIntent('auth-uid-1')).toBeNull();
  });
});
