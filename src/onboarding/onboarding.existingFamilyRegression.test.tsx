import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import i18n from '../i18n/config';
import { useStore } from '../store/useStore';
import { clearDraft, saveDraft } from './lib/onboardingDraft';
import { PROFILE_WAIT_MS } from './lib/onboardingErrors';

const navigate = vi.fn();
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

// Keep real routing primitives, but capture programmatic navigation and turn
// <Navigate> into an observable marker so we can assert redirects.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigate,
    Navigate: ({ to }: { to: string }) =>
      createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
  };
});

import { OnboardingFlow } from './OnboardingFlow';

function renderFlow() {
  return render(
    createElement(MemoryRouter, { initialEntries: ['/onboarding'] }, createElement(OnboardingFlow)),
  );
}

async function setStore(partial: Record<string, unknown>) {
  await act(async () => {
    useStore.setState(partial as never);
  });
}

/** Flush pending microtasks/macrotasks so any erroneous setup call surfaces. */
async function flushSetupAttempts() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  api.createFamilyAndParent.mockResolvedValue({
    familyId: 'family-duplicate',
    inviteCode: 'DUP123',
    user: { id: 'owner-1', familyId: 'family-duplicate', role: 'owner' },
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

/**
 * Regression: an established-family owner can be trapped in post-auth
 * onboarding (P1) by a stale persisted draft + a temporarily familyId-less
 * cached profile. Once the AUTHORITATIVE server-confirmed profile carries a
 * familyId that this onboarding session did not create, the user must exit
 * onboarding immediately — regardless of draft.step — and no duplicate family
 * creation may ever be attempted.
 */
describe('OnboardingFlow — existing-family regression guard', () => {
  function seedStaleP1Draft() {
    // Stale persisted draft left at P1 by an abandoned earlier attempt.
    saveDraft({
      version: 1,
      step: 'p1',
      parentFirstName: 'Kemal',
      parentRoleDisplay: 'parent',
      childFirstName: 'Osman',
      familyName: 'Kemal Family',
      updatedAt: Date.now(),
    });
  }

  it('redirects to / once the authoritative profile confirms an existing family, even with a persisted p1 draft', async () => {
    seedStaleP1Draft();

    // The cached profile temporarily omits familyId, so the stale p1 draft is
    // restored and P1 mounts while bootstrap is still unconfirmed.
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'owner' },
      profileServerConfirmed: false,
    });
    renderFlow();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();

    // The AUTHORITATIVE server-confirmed profile later establishes that this
    // account already belongs to a family.
    await setStore({
      currentUser: { id: 'owner-1', role: 'owner', familyId: 'family-existing' },
      profileServerConfirmed: true,
    });

    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/');
  });

  it('never attempts family creation for an account that already has a family', async () => {
    seedStaleP1Draft();

    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'owner' },
      profileServerConfirmed: false,
    });
    renderFlow();

    // Authoritative profile confirms established-family membership mid-flow.
    await setStore({
      currentUser: { id: 'owner-1', role: 'owner', familyId: 'family-existing' },
      profileServerConfirmed: true,
    });
    await flushSetupAttempts();

    expect(api.createFamilyAndParent).not.toHaveBeenCalled();
    expect(api.createManagedMember).not.toHaveBeenCalled();
  });

  it('pins the bounded 20s profile-unavailable recovery copy', async () => {
    // The deadline for the authoritative profile is exactly 20 seconds.
    expect(PROFILE_WAIT_MS).toBe(20_000);

    // Authenticated but the profile never resolved within the bound: the
    // human-readable recovery copy is surfaced (never a raw internal error).
    await setStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: null,
      profileServerConfirmed: false,
      profileLoading: false,
      bootstrapError: '[Profile] not-found: User profile is not available yet',
    });

    renderFlow();

    expect(screen.getByText('We couldn\'t load your account. Check your connection and try again.'))
      .toBeInTheDocument();
  });
});
