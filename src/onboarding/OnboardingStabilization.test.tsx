import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, StrictMode, useCallback, useState } from 'react';
import i18n from '../i18n/config';
import { clearCreateFamilyIntent, readCreateFamilyIntent, startCreateFamilyIntent } from '../auth/createFamilyIntent';
import { useStore } from '../store/useStore';
import { FamilyComposition } from './postauth/FamilyComposition';
import { createEmptyDraft, saveDraft, clearDraft, type OnboardingDraft } from './lib/onboardingDraft';
import type { SetupDeps } from './lib/onboardingSetup';

// --- Mocks -----------------------------------------------------------------
const api = vi.hoisted(() => ({
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  createFamilyAndParent: vi.fn(),
  createManagedMember: vi.fn().mockResolvedValue('child-1'),
  createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
}));

vi.mock('../lib/api', () => api);
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
vi.mock('../../lib/inviteLink', () => ({ buildJoinUrl: vi.fn(() => 'https://join.example/ABC123') }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Navigate: ({ to }: { to: string }) => createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
  };
});

// --- Helpers ---------------------------------------------------------------
const FAMILY_RESULT = {
  familyId: 'fam-1',
  inviteCode: 'ABC123',
  user: { id: 'u1', familyId: 'fam-1', role: 'owner' },
};

function makeDeps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    uid: 'u1',
    createFamilyAndParent: api.createFamilyAndParent,
    createManagedMember: api.createManagedMember,
    createTask: api.createTask,
    refreshCurrentUser: vi.fn(),
    getFamilyMembers: () => [],
    ...overrides,
  };
}

function p1Draft(): OnboardingDraft {
  return {
    ...createEmptyDraft('p1'),
    parentFirstName: 'Kemal',
    childFirstName: 'Osman',
    familyName: 'Kemal Family',
  };
}

async function setStore(partial: Record<string, unknown>) {
  await act(async () => {
    useStore.setState(partial as never);
  });
}

/**
 * Mirrors the real flow: `useOnboardingMachine` owns the draft and `patch`
 * updates it, re-rendering `FamilyComposition` with the new draft (so the
 * component leaves its loading state once familyId/childId are written).
 */
function renderP1(initialDraft: OnboardingDraft, deps: SetupDeps, goNext: () => void) {
  function Harness() {
    const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
    const patch = useCallback((partial: Partial<OnboardingDraft>) => {
      setDraft(prev => ({ ...prev, ...partial }));
    }, []);
    return createElement(FamilyComposition, { draft, patch, goNext, deps });
  }
  return render(createElement(Harness));
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  clearCreateFamilyIntent();
  startCreateFamilyIntent('u1');
  api.createFamilyAndParent.mockResolvedValue(FAMILY_RESULT);
  api.createManagedMember.mockResolvedValue('child-1');
  api.createTask.mockResolvedValue({ id: 'task-1' });
  await setStore({
    authStatus: 'unauthenticated',
    authUser: null,
    currentUser: null,
    familyData: null,
    bootstrapError: null,
    familyMembers: [],
    profileServerConfirmed: false,
    profileLoading: false,
  });
  await i18n.loadNamespaces(['onboarding', 'common']);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('PRIORITY 0 — post-auth "User not found" race', () => {
  it('performs zero setup writes when the explicit intent is missing', async () => {
    clearCreateFamilyIntent();
    const deps = makeDeps();
    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });

    renderP1(p1Draft(), deps, vi.fn());
    await act(async () => undefined);

    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
    expect(api.createManagedMember).not.toHaveBeenCalled();
  });

  it('performs zero setup writes for a stale same-account intent', async () => {
    startCreateFamilyIntent('u1', Date.now() - 31 * 60 * 1000);
    const deps = makeDeps();
    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });

    renderP1(p1Draft(), deps, vi.fn());
    await act(async () => undefined);

    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
    expect(api.createManagedMember).not.toHaveBeenCalled();
  });

  it('performs zero setup writes and clears a fresh other-account intent', async () => {
    startCreateFamilyIntent('other-uid');
    const deps = makeDeps();
    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });

    renderP1(p1Draft(), deps, vi.fn());
    await act(async () => undefined);

    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
    expect(api.createManagedMember).not.toHaveBeenCalled();
    expect(readCreateFamilyIntent('other-uid')).toBeNull();
  });

  it('waits for the authoritative profile, then creates family + child exactly once', async () => {
    const goNext = vi.fn();
    const deps = makeDeps();

    // 1-2. auth succeeded, onboarding resumed, but the profile doc is not yet
    // server-confirmed (the race window).
    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: false,
      profileLoading: true,
    });
    renderP1(p1Draft(), deps, goNext);

    // 3. profile temporarily unresolved → setup must NOT have started.
    expect(api.createFamilyAndParent).not.toHaveBeenCalled();

    // 4. profile becomes available on the server.
    await setStore({ profileServerConfirmed: true, profileLoading: false });

    // 5. setup proceeds exactly once.
    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.createManagedMember).toHaveBeenCalledTimes(1));

    // 6. no permanent disabled state — the continue control is reachable.
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
  });

  it('never surfaces a raw "User not found" string', async () => {
    api.createFamilyAndParent.mockRejectedValue(new Error('User not found'));
    const goNext = vi.fn();
    const deps = makeDeps();

    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });
    renderP1(p1Draft(), deps, goNext);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).not.toHaveTextContent(/user not found/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't set up your family/i);
  });
});

describe('PRIORITY 1 — StrictMode / effect idempotency', () => {
  it('completes setup exactly once under React.StrictMode (no permanent disabled state)', async () => {
    const goNext = vi.fn();
    const deps = makeDeps();

    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });
    render(
      createElement(StrictMode, null, createElement(FamilyCompositionHarness, { deps, goNext })),
    );

    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.createManagedMember).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
  });

  it('does not duplicate the family when the effect replays', async () => {
    const goNext = vi.fn();
    const deps = makeDeps();

    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });
    render(
      createElement(StrictMode, null, createElement(FamilyCompositionHarness, { deps, goNext })),
    );

    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(1));
    // A second authoritative mutation caused by effect replay must not happen.
    expect(api.createFamilyAndParent).toHaveBeenCalledTimes(1);
    expect(api.createManagedMember).toHaveBeenCalledTimes(1);
  });
});

// Harness used by the StrictMode tests (keeps draft state across the double
// mount so the component can leave its loading state after setup).
function FamilyCompositionHarness({ deps, goNext }: { deps: SetupDeps; goNext: () => void }) {
  const [draft, setDraft] = useState<OnboardingDraft>(p1Draft());
  const patch = useCallback((partial: Partial<OnboardingDraft>) => {
    setDraft(prev => ({ ...prev, ...partial }));
  }, []);
  return createElement(FamilyComposition, { draft, patch, goNext, deps });
}

describe('PRIORITY 1 — post-auth progress continuity', () => {
  it('shows 1/3 before and after familyId appears (never resets to 0/7)', async () => {
    await act(async () => {
      saveDraft({ ...createEmptyDraft('p1'), parentFirstName: 'Kemal', childFirstName: 'Osman', familyName: 'Fam' });
    });
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'u1' },
      currentUser: { id: 'u1', role: 'parent' },
      profileServerConfirmed: true,
      bootstrapError: null,
      familyMembers: [],
      familyData: null,
    });

    const { OnboardingFlow } = await import('./OnboardingFlow');
    const { MemoryRouter } = await import('react-router-dom');
    render(
      createElement(MemoryRouter, { initialEntries: ['/onboarding?mode=create'] }, createElement(OnboardingFlow)),
    );

    const navBefore = screen.getByRole('navigation', { name: /setting up your family/i });
    expect(navBefore).toHaveTextContent(/step 1 of 3/i);

    // Family created (simulating refreshCurrentUser after createFamilyAndParent).
    await setStore({ currentUser: { id: 'u1', role: 'owner', familyId: 'fam-1' } });

    const navAfter = screen.getByRole('navigation', { name: /setting up your family/i });
    expect(navAfter).toHaveTextContent(/step 1 of 3/i);
    expect(navAfter).not.toHaveTextContent(/0 of 7/i);
    expect(navAfter).not.toHaveTextContent(/step 0 of/i);
  });
});

describe('PRIORITY 2 — offline / network feedback', () => {
  it('shows a recoverable offline message, then completes on retry without a duplicate child', async () => {
    const user = userEvent.setup();
    api.createFamilyAndParent
      .mockRejectedValueOnce(new Error('network down')) // first attempt: offline
      .mockResolvedValueOnce(FAMILY_RESULT); // retry: succeeds
    const goNext = vi.fn();
    const deps = makeDeps();

    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });
    renderP1(p1Draft(), deps, goNext);

    // Recoverable, human-readable error — never the raw string.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent('network down');

    // Retry.
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(2));
    // The child is created exactly once (only after the successful family create).
    await waitFor(() => expect(api.createManagedMember).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
  });

  it('entered draft state is retained across an error and recovered on retry', async () => {
    const user = userEvent.setup();
    api.createFamilyAndParent
      .mockRejectedValueOnce(new Error('unavailable')) // first attempt fails
      .mockResolvedValueOnce(FAMILY_RESULT); // retry succeeds
    const goNext = vi.fn();
    const deps = makeDeps();

    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });
    renderP1(p1Draft(), deps, goNext);

    // Recoverable error — the entered draft is not wiped.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    // Retry recovers and the previously entered names are still present.
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Kemal')).toBeInTheDocument());
    expect(screen.getByText('Osman')).toBeInTheDocument();
  });

  it('keeps the intent after an ambiguous create error and through idempotent recovery', async () => {
    const user = userEvent.setup();
    api.createFamilyAndParent
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(FAMILY_RESULT);
    await setStore({
      currentUser: { id: 'u1', role: 'parent' },
      familyData: null,
      profileServerConfirmed: true,
      profileLoading: false,
    });

    renderP1(p1Draft(), makeDeps(), vi.fn());

    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(readCreateFamilyIntent('u1')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.createFamilyAndParent).toHaveBeenCalledTimes(2));
    expect(readCreateFamilyIntent('u1')).not.toBeNull();
  });
});
