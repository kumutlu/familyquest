import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

import { WalletSummaryCard } from './WalletSummaryCard';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';

const baseStore = {
  currentUser: { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' },
  myWallet: { id: 'w-1', balance: 1234 },
  childWallets: [] as any[],
  familyMembers: [] as any[],
  familyData: null as any,
  bootstrapStatus: { wallets: 'ready', members: 'ready' } as any,
};

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: (state: typeof baseStore) => unknown) => selector ? selector(baseStore) : baseStore,
}));

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

describe('WalletSummaryCard', () => {
  beforeEach(() => {
    localStorage.clear();
    h.navigate.mockClear();
    baseStore.currentUser = { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' };
    baseStore.myWallet = { id: 'w-1', balance: 1234 };
    baseStore.childWallets = [];
    baseStore.familyMembers = [];
    baseStore.familyData = null;
    baseStore.bootstrapStatus = { wallets: 'ready', members: 'ready' };
  });

  it('child sees own balance and the full card links to /wallet', () => {
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    const card = screen.getByTestId('wallet-summary');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('My Wallet')).toBeInTheDocument();
    expect(screen.getByText('£12.34')).toBeInTheDocument();
    // No redundant ghost arrow button.
    expect(screen.queryByTestId('wallet-summary-link')).not.toBeInTheDocument();
    // Whole card is tappable.
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/wallet');
  });

  it('shows a local skeleton while wallet data loads', () => {
    baseStore.bootstrapStatus = { wallets: 'loading', members: 'ready' };
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary-loading')).toBeInTheDocument();
    expect(screen.queryByText('£12.34')).not.toBeInTheDocument();
  });

  it('shows a local error without replacing the dashboard when wallets fail', () => {
    baseStore.bootstrapStatus = { wallets: 'error', members: 'ready' };
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary-error')).toBeInTheDocument();
  });

  it('child card is keyboard accessible', () => {
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    const card = screen.getByTestId('wallet-summary');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(h.navigate).toHaveBeenCalledWith('/wallet');
    h.navigate.mockClear();
    fireEvent.keyDown(card, { key: ' ' });
    expect(h.navigate).toHaveBeenCalledWith('/wallet');
  });

  it('parent sees aggregate of children wallets and links to /wallets', () => {
    baseStore.currentUser = { id: 'p-1', familyId: 'f-1', role: 'parent', displayName: 'Parent' };
    baseStore.childWallets = [
      { id: 'c-1', balance: 500 },
      { id: 'c-2', balance: 250 },
    ];
    baseStore.familyMembers = [
      { id: 'c-1', role: 'child' },
      { id: 'c-2', role: 'child' },
    ];
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    expect(screen.getByText('Family Wallets')).toBeInTheDocument();
    expect(screen.getByText('£7.50')).toBeInTheDocument();
    const card = screen.getByTestId('wallet-summary');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });

  it.each([
    ['child', 'u-1', 1234],
    ['parent', 'p-1', 750],
  ] as const)('masks the %s wallet summary when privacy is enabled', (role, userId, amountPence) => {
    baseStore.currentUser = { id: userId, familyId: 'f-1', role, displayName: 'User' };
    if (role === 'parent') {
      baseStore.childWallets = [
        { id: 'c-1', balance: 500 },
        { id: 'c-2', balance: 250 },
      ];
      baseStore.familyMembers = [
        { id: 'c-1', role: 'child' },
        { id: 'c-2', role: 'child' },
      ];
    }
    localStorage.setItem(`queki.moneyPrivacy:${userId}`, 'true');

    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);

    const formatted = amountPence === 1234 ? '£12.34' : '£7.50';
    expect(document.body.textContent).not.toContain(formatted);
    expect(screen.getByTestId('wallet-summary')).toHaveTextContent('£••••');
  });

  it('owner is treated as parent (links to /wallets)', () => {
    baseStore.currentUser = { id: 'o-1', familyId: 'f-1', role: 'owner', displayName: 'Owner' };
    baseStore.childWallets = [{ id: 'c-1', balance: 0 }];
    baseStore.familyMembers = [];
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    expect(screen.getByText('Family Wallets')).toBeInTheDocument();
    const card = screen.getByTestId('wallet-summary');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });

  it('only counts wallets belonging to active child members (not legacy/synthetic records)', () => {
    baseStore.currentUser = { id: 'p-1', familyId: 'f-1', role: 'parent', displayName: 'Parent' }
    baseStore.childWallets = [
      { id: 'c-1', balance: 500 },
      { id: 'c-2', balance: 250 },
      { id: 'legacy-wallet', balance: 100 },
    ]
    baseStore.familyMembers = [
      { id: 'c-1', role: 'child' },
      { id: 'c-2', role: 'child' },
    ]
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>)
    expect(screen.getByText('2 of 2 child wallets linked')).toBeInTheDocument()
    expect(screen.getByText('£7.50')).toBeInTheDocument()
  })
});
