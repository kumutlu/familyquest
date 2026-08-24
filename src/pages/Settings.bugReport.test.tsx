import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';
import { ProfileDropdown } from '../components/layout/ProfileDropdown';
import { HelpHome } from '../help/pages/HelpHome';
import { useStore } from '../store/useStore';
import i18n from '../i18n/config';

vi.mock('../lib/api', () => ({
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
  getAuthProviderInfo: vi.fn(() => ({ hasPasswordProvider: true, isEmailPassword: true })),
  mapAuthErrorMessage: vi.fn(),
  updateLanguagePreference: vi.fn(),
  updateFamilySettings: vi.fn(),
}));

vi.mock('../lib/useNotifications', () => ({
  useNotifications: () => ({
    connectionState: 'connected',
    retry: vi.fn(),
  }),
}));

vi.mock('../lib/pushNotifications', () => ({
  loadPushState: vi.fn(async () => ({ supported: false })),
  registerCurrentDevice: vi.fn(),
  unregisterCurrentDevice: vi.fn(),
}));

function seedStore(role: string) {
  act(() => {
    useStore.setState({
      currentUser: {
        id: 'u1',
        displayName: 'Test User',
        email: 'test@example.com',
        avatarUrl: '',
        role,
        familyId: 'fam1',
        language: 'en',
      },
      authUser: { email: 'test@example.com', uid: 'u1' },
      familyData: { id: 'fam1', name: 'The Family', inviteCode: 'ABC123' },
      familyMembers: [
        { id: 'u1', displayName: 'Test User', role },
        { id: 'u2', displayName: 'Kid One', role: 'child' },
        { id: 'u3', displayName: 'Parent Two', role: 'parent' },
      ],
      joinRequests: [],
      familyLoading: false,
    });
  });
}

function renderSettings(role: string) {
  seedStore(role);
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe('Bug Report Entry Points — Wave 4.2', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.loadNamespaces(['settings', 'common', 'help']);
    await i18n.changeLanguage('en');
  });

  it('10 & 11. owner can open Report a Problem from Settings', async () => {
    renderSettings('owner');

    const reportButton = await screen.findByTestId('open-bug-report');
    expect(reportButton).toBeInTheDocument();
    expect(reportButton).toHaveTextContent('Report a problem');

    fireEvent.click(reportButton);
    expect(screen.getByTestId('bug-report-sheet')).toBeInTheDocument();
  });

  it('12. parent can open Report a Problem from Settings', async () => {
    renderSettings('parent');

    const reportButton = await screen.findByTestId('open-bug-report');
    expect(reportButton).toBeInTheDocument();

    fireEvent.click(reportButton);
    expect(screen.getByTestId('bug-report-sheet')).toBeInTheDocument();
  });

  it('13. child can open Report a Problem from Settings', async () => {
    renderSettings('child');

    const reportButton = await screen.findByTestId('open-bug-report');
    expect(reportButton).toBeInTheDocument();

    fireEvent.click(reportButton);
    expect(screen.getByTestId('bug-report-sheet')).toBeInTheDocument();
  });

  it('child/parent/owner can open Report a Problem from ProfileDropdown', async () => {
    seedStore('child');
    render(
      <MemoryRouter>
        <ProfileDropdown />
      </MemoryRouter>,
    );

    // Open profile menu - button has user name or aria-label
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    const problemMenuOption = screen.getByRole('menuitem', { name: 'Report a problem' });
    expect(problemMenuOption).toBeInTheDocument();

    fireEvent.click(problemMenuOption);
    expect(screen.getByTestId('bug-report-sheet')).toBeInTheDocument();
  });

  it('can open Report a Problem from HelpHome banner', async () => {
    seedStore('parent');
    render(
      <MemoryRouter>
        <HelpHome />
      </MemoryRouter>,
    );

    const helpReportButton = await screen.findByTestId('help-open-bug-report');
    expect(helpReportButton).toBeInTheDocument();

    fireEvent.click(helpReportButton);
    expect(screen.getByTestId('bug-report-sheet')).toBeInTheDocument();
  });
});
