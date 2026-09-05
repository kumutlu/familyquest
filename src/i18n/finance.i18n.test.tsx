import { render as rtlRender, screen, cleanup, act, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './config';
import { formatPence } from './format';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam' },
  familyMembers: [] as any[],
  familyData: { id: 'f1', currency: '£' },
  savingsGoals: [] as any[],
  myWallet: { balance: 5000 },
  loading: false,
}));

vi.mock('../store/useStore', () => ({ useStore: () => store }));

const api = vi.hoisted(() => ({
  createGoal: vi.fn(),
  deleteCancelledGoal: vi.fn(),
  contributeToGoal: vi.fn(),
}));
vi.mock('../lib/api', () => api);

vi.mock('../lib/roles', () => ({
  isParentRole: (role: string) => role === 'parent' || role === 'owner',
  isChildRole: (role: string) => role === 'child',
  getRoleLabel: (role: string) => role,
}));

import { Goals } from '../pages/Goals';
import { BalanceCard } from '../components/wallet/BalanceCard';
import { ContributionModal } from '../components/goals/ContributionModal';
import { TransactionList } from '../components/wallet/TransactionList';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../components/privacy/MoneyPrivacyToggle';

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  store.currentUser = { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam' };
  store.familyMembers = [];
  store.familyData = { id: 'f1', currency: '£' };
  store.savingsGoals = [];
  store.myWallet = { balance: 5000 };
  store.loading = false;
  await i18n.loadNamespaces(['goals', 'wallet', 'funds', 'help', 'common']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(() => {
  cleanup();
});

describe('Finance i18n — currency formatting', () => {
  it('formats stored pence consistently and locale-aware', () => {
    // The app stores integer pence; formatPence converts to major units.
    expect(formatPence(12345, 'GBP', 'en')).toBe('£123.45');
    // Turkish uses a comma decimal separator (symbol placement is locale-driven).
    expect(formatPence(12345, 'GBP', 'tr')).toMatch(/£123[,.]45/);
  });
});

describe('Finance i18n — Goals page (English)', () => {
  it('renders the Goals headings in English', () => {
    render(withRouter(<Goals />));
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Family Goals')).toBeInTheDocument();
    expect(screen.getByText('Child Goals')).toBeInTheDocument();
    expect(screen.getByText('New Goal')).toBeInTheDocument();
  });
});

describe('Finance i18n — Goals page (Turkish)', () => {
  it('renders the Goals headings in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    render(withRouter(<Goals />));
    expect(screen.getByText('Hedefler')).toBeInTheDocument();
    expect(screen.getByText('Aile Hedefleri')).toBeInTheDocument();
    expect(screen.getByText('Çocuk Hedefleri')).toBeInTheDocument();
    expect(screen.getByText('Yeni Hedef')).toBeInTheDocument();
  });
});

describe('Finance i18n — language switching', () => {
  it('switches the Goals headings from English to Turkish', async () => {
    const { rerender } = render(withRouter(<Goals />));
    expect(screen.getByText('Goals')).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('tr'); });
    rerender(withRouter(<Goals />));
    expect(screen.getByText('Hedefler')).toBeInTheDocument();
  });
});

describe('Finance i18n — Wallet BalanceCard', () => {
  it('renders the balance label and formatted currency in English', () => {
    render(<BalanceCard balance={12345} currency="£" />);
    expect(screen.getByText('Available balance')).toBeInTheDocument();
    expect(screen.getByText('£123.45')).toBeInTheDocument();
  });

  it('renders the balance label in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    render(<BalanceCard balance={12345} currency="£" />);
    expect(screen.getByText('Kullanılabilir bakiye')).toBeInTheDocument();
  });
});

describe('Finance i18n — Contribution dialog', () => {
  const goal = {
    id: 'g1',
    goalId: 'g1',
    title: 'Holiday',
    kind: 'family',
    targetAmountPence: 10000,
    currentAmountPence: 0,
    status: 'active',
    version: 1,
  };

  it('renders the contribution dialog in English', () => {
    render(<ContributionModal goal={goal} isOpen onClose={() => {}} />);
    expect(screen.getByText('Contribute to Holiday')).toBeInTheDocument();
    expect(screen.getByText('Your balance')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('renders the contribution dialog in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    render(<ContributionModal goal={goal} isOpen onClose={() => {}} />);
    expect(screen.getByText('Holiday hedefine katkı yap')).toBeInTheDocument();
  });

  it('masks the source wallet balance while keeping the active contribution amount visible', () => {
    render(
      <>
        <MoneyPrivacyToggle />
        <ContributionModal goal={goal} isOpen onClose={() => {}} />
      </>,
    );

    expect(screen.getByText('£50.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    expect(screen.queryByText('£50.00')).not.toBeInTheDocument();
    expect(screen.getByText('£••••')).toBeInTheDocument();

    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '12.34' } });
    expect(amountInput).toHaveValue(12.34);
  });
});

describe('Finance i18n — Wallet ledger empty state', () => {
  it('renders the empty ledger state in English', () => {
    render(<TransactionList transactions={[]} loading={false} currency="£" hasMore={false} onLoadMore={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('No wallet activity yet')).toBeInTheDocument();
  });

  it('renders the empty ledger state in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    render(<TransactionList transactions={[]} loading={false} currency="£" hasMore={false} onLoadMore={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('Henüz cüzdan etkinliği yok')).toBeInTheDocument();
  });
});
