import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryAction } from '../../lib/reversalHistory';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn() }));
const store = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../../lib/reversalApi', () => api);
vi.mock('../../store/useStore', () => ({
  useStore: (selector?: (state: typeof store.state) => unknown) =>
    typeof selector === 'function' ? selector(store.state) : store.state,
}));

import { ReversalActionModal } from './ReversalActionModal';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

const action: HistoryAction = {
  sourceKind: 'wallet_transaction', sourceId: 'tx-1', source: {}, summary: 'Pocket money',
  action: 'reverse', actionLabel: 'undo', targets: [{ id: 'child-1', label: 'Alex wallet', originalDelta: 300, predictedBalance: 200, unit: 'money' }],
};

describe('ReversalActionModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await i18n.loadNamespaces(['reversals']);
    await i18n.changeLanguage('en');
    store.state = {
      currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent' },
      familyData: { id: 'family-1', currencyCode: 'GBP' },
    };
  });

  it('shows the exact warning, signed original effect, target, and prediction', () => {
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={vi.fn()} />);
    expect(screen.getByText('This creates a linked reversal record. The original action will remain in history.')).toBeInTheDocument();
    expect(screen.getByText('Alex wallet')).toBeInTheDocument();
    expect(screen.getByText('Original: +£3.00')).toBeInTheDocument();
    expect(screen.getByText('Predicted balance: £2.00')).toBeInTheDocument();
  });

  it('localizes reversible reward point deltas and balances in Turkish', async () => {
    await i18n.loadNamespaces(['reversals', 'wallet']);
    await i18n.changeLanguage('tr');
    const rewardAction: HistoryAction = {
      sourceKind: 'reward_redemption',
      sourceId: 'redemption-1',
      source: {},
      summary: 'Ödül kullanıldı: Bisiklet',
      action: 'reverse',
      actionLabel: 'refund',
      targets: [{
        id: 'child-1',
        label: 'Alex puanı',
        originalDelta: -100,
        predictedBalance: 250,
        unit: 'points',
      }],
    };

    render(<ReversalActionModal open familyId="family-1" historyAction={rewardAction} onClose={vi.fn()} />);

    expect(screen.getByText('Orijinal: -100 puan')).toBeInTheDocument();
    expect(screen.getByText('Tahmini bakiye: 250 puan')).toBeInTheDocument();
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it('masks the stored summary, original money effect, and predicted wallet balance', () => {
    const privateAction: HistoryAction = {
      sourceKind: 'wallet_transaction',
      sourceId: 'private-tx',
      source: {},
      summary: 'Lunch correction £406.29',
      action: 'reverse',
      actionLabel: 'undo',
      targets: [{
        id: 'child-private',
        label: 'Alex wallet',
        originalDelta: 52_713,
        predictedBalance: 31_684,
        unit: 'money',
      }],
    };

    render(
      <>
        <MoneyPrivacyToggle />
        <ReversalActionModal open familyId="family-1" historyAction={privateAction} onClose={vi.fn()} />
      </>,
    );

    expect(document.body).toHaveTextContent('Lunch correction £406.29');
    expect(document.body).toHaveTextContent('Original: +£527.13');
    expect(document.body).toHaveTextContent('Predicted balance: £316.84');

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(document.body.innerHTML).not.toContain('406.29');
    expect(document.body.innerHTML).not.toContain('527.13');
    expect(document.body.innerHTML).not.toContain('316.84');
    expect(screen.getAllByText('£••••')).toHaveLength(3);
  });

  it('requires a trimmed reason of at least three characters', async () => {
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' x ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Reason must be at least 3 characters.')).toBeInTheDocument();
    expect(api.reverseTransaction).not.toHaveBeenCalled();
  });

  it('blocks double submit synchronously and closes only after success', async () => {
    let resolve!: (value: unknown) => void;
    api.reverseTransaction.mockReturnValue(new Promise(value => { resolve = value; }));
    const onClose = vi.fn();
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate' } });
    const submit = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.reverseTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Undoing…' })).toBeDisabled();
    resolve({ status: 'completed' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('retains the modal and reason while displaying the exact failed-action error', async () => {
    api.reverseTransaction.mockRejectedValue(Object.assign(new Error('Insufficient fund balance to reverse'), { code: 'failed-precondition' }));
    const onClose = vi.fn();
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('failed-precondition: Insufficient fund balance to reverse')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveValue('Duplicate');
    expect(onClose).not.toHaveBeenCalled();
  });
});
