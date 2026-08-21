import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import i18n from '../i18n/config';
import { useStore } from '../store/useStore';
import { useAppearanceStore } from '../store/appearanceStore';
import { clearDraft } from './lib/onboardingDraft';
import { OnboardingFlow } from './OnboardingFlow';

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
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigate,
    Navigate: ({ to }: { to: string }) => createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
  };
});

function renderFlow() {
  return render(
    createElement(MemoryRouter, { initialEntries: ['/onboarding'] }, createElement(OnboardingFlow)),
  );
}

async function setSignedOut() {
  await act(async () => {
    useStore.setState({
      authStatus: 'unauthenticated',
      authUser: null,
      currentUser: null,
      bootstrapError: null,
      familyMembers: [],
      familyData: null,
      profileServerConfirmed: true,
    } as never);
  });
}

function installMatchMedia(initial: boolean) {
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  installMatchMedia(false);
  await i18n.loadNamespaces(['onboarding', 'common']);
  await i18n.changeLanguage('en');
  await setSignedOut();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  localStorage.clear();
  useAppearanceStore.setState({
    appearance: 'system',
    systemDark: false,
    resolvedTheme: 'light',
    initialized: false,
  });
});

describe('Onboarding appearance — follows the resolved app theme', () => {
  it('renders dark-compatible surfaces when <html> is dark (OS dark)', () => {
    // Simulate an OS/browser that prefers dark (fresh private/incognito context).
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';

    const { container } = renderFlow();
    const root = container.querySelector('[data-testid="onboarding-shell"]');
    expect(root).toHaveClass('dark:bg-slate-950');
    expect(container.querySelector('.light')).toBeNull();
  });

  it('does not force a light subtree for a persisted dark appearance', () => {
    // Simulate a stale persisted dark preference from a previous authenticated session.
    localStorage.setItem('queki:appearance', 'dark');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';

    const { container } = renderFlow();
    expect(container.querySelector('[data-testid="onboarding-shell"]')).toBeTruthy();
    expect(container.querySelector('.light')).toBeNull();
  });

  it('authenticated dark preference is honoured and not mutated', () => {
    // An authenticated user who chose Dark.
    localStorage.setItem('queki:appearance', 'dark');
    useAppearanceStore.getState().initAppearance();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(useAppearanceStore.getState().appearance).toBe('dark');

    const { container, unmount } = renderFlow();
    expect(container.querySelector('[data-testid="onboarding-shell"]')).toHaveClass('dark:bg-slate-950');

    unmount();
    // The preference is untouched → the authenticated app remains dark.
    expect(useAppearanceStore.getState().appearance).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('queki:appearance')).toBe('dark');
  });
});

describe('Onboarding appearance — theme-safe root contract', () => {
  it('does not apply a forced-light override class', () => {
    const { container } = renderFlow();
    expect(container.querySelector('.light')).toBeNull();
  });
});
