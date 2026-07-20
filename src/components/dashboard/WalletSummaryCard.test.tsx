import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

import { WalletSummaryCard } from './WalletSummaryCard';

const baseStore = {
  currentUser: { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' },
  myWallet: { id: 'w-1', balance: 1234 },
  childWallets: [] as any[],
  familyMembers: [] as any[],
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

describe('WalletSummaryCard', () => {
  beforeEach(() => {
    h.navigate.mockClear();
    baseStore.currentUser = { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' };
    baseStore.myWallet = { id: 'w-1', balance: 1234 };
    baseStore.childWallets = [];
    baseStore.familyMembers = [];
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
      { id: 'w-1', balance: 500 },
      { id: 'w-2', balance: 250 },
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

  it('owner is treated as parent (links to /wallets)', () => {
    baseStore.currentUser = { id: 'o-1', familyId: 'f-1', role: 'owner', displayName: 'Owner' };
    baseStore.childWallets = [{ id: 'w-1', balance: 0 }];
    baseStore.familyMembers = [];
    render(<MemoryRouter><WalletSummaryCard /></MemoryRouter>);
    expect(screen.getByText('Family Wallets')).toBeInTheDocument();
    const card = screen.getByTestId('wallet-summary');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });
});
