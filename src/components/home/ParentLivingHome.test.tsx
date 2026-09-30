import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { ParentLivingHome } from './ParentLivingHome';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../../store/useStore', () => ({
  useStore: () => store.state,
}));

vi.mock('../family/AddChildModal', () => ({
  AddChildModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-add-child-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const owner = {
  id: 'owner-1',
  uid: 'owner-1',
  familyId: 'family-1',
  role: 'owner',
  displayName: 'Kemal',
};

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    currentUser: owner,
    familyData: { id: 'family-1', currency: '£', inviteCode: 'ABC123' },
    familyMembers: [owner],
    myWallet: { balance: 0 },
    childWallets: [],
    funds: [],
    tasks: [],
    rewards: [],
    taskCompletions: [],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    profileUpdateRequests: [],
    goalRequests: [],
    childJoinRequests: [],
    childQrJoinRequests: [],
    savingsGoals: [],
    challenges: [],
    gamificationSummaries: [],
    bootstrapStatus: {
      members: 'ready',
      tasks: 'ready',
      rewards: 'ready',
      childQrJoinRequests: 'ready',
    },
    retryFeature: vi.fn(),
    ...overrides,
  };
}

describe('ParentLivingHome — Zero-child first-class support', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.state = baseState();
    await i18n.loadNamespaces(['common', 'home', 'dashboard', 'approvals', 'family']);
    await i18n.changeLanguage('en');
  });

  it('renders the living home without being blocked by focus mode when a family has zero children', () => {
    render(
      <MemoryRouter>
        <MoneyPrivacyProvider>
          <ParentLivingHome />
        </MoneyPrivacyProvider>
      </MemoryRouter>,
    );

    // Must NOT render full-screen focus mode
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();

    // Must render the zero-child card
    expect(screen.getByTestId('parent-zero-child-card')).toBeInTheDocument();
    expect(screen.getByText(/welcome to your family workspace/i)).toBeInTheDocument();
  });

  it('opens AddChildModal when clicking + Add a child from the zero-child card', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MoneyPrivacyProvider>
          <ParentLivingHome />
        </MoneyPrivacyProvider>
      </MemoryRouter>,
    );

    const addChildBtn = screen.getByTestId('zero-child-add-child-btn');
    await user.click(addChildBtn);

    expect(screen.getByTestId('mock-add-child-modal')).toBeInTheDocument();
  });
});
