import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../i18n/config';
import App from '../../App';
import { Settings } from '../../pages/Settings';
import { Family } from '../../pages/Family';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const appStoreState = vi.hoisted(() => ({
  authStatus: 'authenticated',
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'family-1', role: 'owner', lifecycle: 'active', displayName: 'Owner' } as any,
  familyData: { id: 'family-1', name: 'The Family', lifecycleState: 'active', currencyCode: 'GBP' } as any,
  familyMembers: [{ id: 'child-1', displayName: 'Dashboard Child', role: 'child' }] as any[],
  tasks: [] as any[],
  rewards: [] as any[],
  notifications: [] as any[],
  profileServerConfirmed: true,
  appReady: true,
  bootstrapError: null as string | null,
  pendingMembershipStatus: 'none',
  bootstrapAttempt: 0,
  retryBootstrap: vi.fn(),
  initAuth: vi.fn(),
  currency: 'GBP',
}));

vi.mock('../../store/useStore', () => {
  const mockFn = (selector?: any) => (selector ? selector(appStoreState) : appStoreState);
  mockFn.getState = () => appStoreState;
  mockFn.setState = vi.fn();
  mockFn.subscribe = vi.fn(() => () => {});
  return {
    useStore: mockFn,
    logAuthTrace: vi.fn(),
  };
});

vi.mock('../../lib/api', () => ({
  signOut: vi.fn(async () => {}),
  getAuthProviderInfo: () => ({ isEmailPassword: false }),
  updateLanguagePreference: vi.fn(),
}));

vi.mock('../../lib/useNotifications', () => ({
  useNotifications: () => ({
    connectionState: 'connected',
    notifications: [],
    readIds: new Set(),
    markRead: vi.fn(async () => {}),
  }),
}));

vi.mock('../../lib/pushNotifications', () => ({
  loadPushState: vi.fn(async () => ({ status: 'not_enabled' })),
  registerCurrentDevice: vi.fn(),
  unregisterCurrentDevice: vi.fn(),
  initForegroundMessaging: vi.fn(async () => {}),
}));

describe('Manage Family Route & Navigation Regression', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'family', 'settings', 'familyWorld']);
    await i18n.changeLanguage('en');
  });

  it('safely resolves direct navigation to /settings/family via redirect without empty outlet', async () => {
    window.history.pushState({}, '', '/settings/family');
    render(<App />);

    // Renders the Settings page and family section instead of empty outlet
    const headings = await screen.findAllByRole('heading', { name: /family/i });
    expect(headings.length).toBeGreaterThan(0);
    expect(window.location.hash).toBe('#family-section');
  });

  it('navigates to /settings#family-section when clicking Family Settings in Family page', async () => {
    render(
      <MemoryRouter initialEntries={['/family']}>
        <Routes>
          <Route path="/family" element={<Family />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    );

    const familySettingsBtn = screen.getByRole('button', { name: /Family Settings/i });
    expect(familySettingsBtn).toBeInTheDocument();

    fireEvent.click(familySettingsBtn);

    // After clicking, settings is rendered with the family section
    const headings = await screen.findAllByRole('heading', { name: /family/i });
    expect(headings.length).toBeGreaterThan(0);
  });

  it('scrolls family-section into view when hash is #family-section', async () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <MemoryRouter initialEntries={['/settings#family-section']}>
        <Settings />
      </MemoryRouter>
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });
});
