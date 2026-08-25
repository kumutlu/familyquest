import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn(), cancelPendingApproval: vi.fn() }));
const store = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../../lib/reversalApi', () => ({ reverseTransaction: api.reverseTransaction }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: api.cancelPendingApproval }));
vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));

import { HistoryActionControl } from './HistoryActionControl';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

const baseState = () => ({
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
  familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }], childWallets: [{ id: 'child-1', balance: 500 }],
  funds: [], tasks: [], rewards: [], reversals: [],
});

describe('HistoryActionControl', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await i18n.loadNamespaces(['reversals']);
    await i18n.changeLanguage('en');
    store.state = baseState();
  });

  it('renders persisted reversal reason, actor, and completedAt rather than epoch time', () => {
    store.state.reversals = [{ sourceKind: 'wallet_transaction', sourceId: 'tx-1', reason: 'Duplicate', actorName: 'Owner', completedAt: { toDate: () => new Date('2026-07-13T10:00:00Z') } }];
    render(<HistoryActionControl sourceKind="wallet_transaction" source={{ id: 'tx-1', type: 'deposit', effectSnapshot: { schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 100, xpAdjustment: 0 } }} />);
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('masks an amount-bearing persisted reversal reason without changing the audit record', () => {
    store.state.reversals = [{
      sourceKind: 'wallet_transaction',
      sourceId: 'private-reversal',
      reason: 'Duplicate lunch split £274.65',
      actorName: 'Owner',
      completedAt: { toDate: () => new Date('2026-07-13T10:00:00Z') },
    }];
    const source = {
      id: 'private-reversal',
      type: 'deposit',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'wallet_transaction',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        walletDeltaPence: 100,
        xpAdjustment: 0,
      },
    };

    render(
      <>
        <MoneyPrivacyToggle />
        <HistoryActionControl sourceKind="wallet_transaction" source={source} />
      </>,
    );

    expect(document.body).toHaveTextContent('Duplicate lunch split £274.65');
    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    expect(document.body.innerHTML).not.toContain('274.65');
    expect(document.body).toHaveTextContent('Duplicate lunch split £••••');

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));
    expect(document.body).toHaveTextContent('Duplicate lunch split £274.65');
  });

  it('keeps the real nested refund dialog private for stored and derived money values', () => {
    store.state.childWallets = [{ id: 'child-1', balance: 91_846 }];
    const source = {
      id: 'private-refund',
      type: 'withdrawal',
      note: 'Correction for £735.91',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'wallet_transaction',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        walletDeltaPence: -64_237,
        xpAdjustment: 0,
      },
    };

    render(
      <>
        <MoneyPrivacyToggle />
        <HistoryActionControl sourceKind="wallet_transaction" source={source} />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }));

    const dialog = screen.getByRole('dialog', { name: 'Refund donation' });
    expect(dialog.innerHTML).not.toContain('735.91');
    expect(dialog.innerHTML).not.toContain('642.37');
    expect(dialog.innerHTML).not.toContain('1,560.83');
    expect(within(dialog).getAllByText('£••••')).toHaveLength(3);
  });

  it('routes a real child-created pending request through parent cancellation and updates immediately', async () => {
    api.cancelPendingApproval.mockResolvedValue(undefined);
    render(<HistoryActionControl sourceKind="transfer_request" source={{ id: 'request-1', status: 'pending', fromChildId: 'child-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(api.cancelPendingApproval).toHaveBeenCalledWith('family-1', 'transfer', 'request-1'));
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('does not expose a reversal control to a child', () => {
    store.state.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Alex' };
    render(<HistoryActionControl sourceKind="wallet_transaction" source={{ id: 'tx-1', type: 'deposit', effectSnapshot: { schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 100, xpAdjustment: 0 } }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
