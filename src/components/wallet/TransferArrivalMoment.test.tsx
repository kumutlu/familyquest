import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

const useStoreMock = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { TransferArrivalMoment } from './TransferArrivalMoment';

const members = [
  { id: 'me', displayName: 'Ada' },
  { id: 'ali', displayName: 'Ali', avatarUrl: 'ali.png' },
];

function tx(overrides: Record<string, unknown> & { id: string }) {
  return {
    type: 'transfer_in',
    childId: 'me',
    counterpartyChildId: 'ali',
    amountPence: 200,
    ...overrides,
  };
}

function renderMoment(transactions: any[]) {
  return render(
    <MoneyPrivacyProvider>
      <TransferArrivalMoment
        transactions={transactions}
        currentUserId="me"
        familyMembers={members}
        familyData={{}}
        currencyCode="GBP"
      />
    </MoneyPrivacyProvider>,
  );
}

describe('TransferArrivalMoment (Wave 3 recipient feedback)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'wallet']);
  });

  it('masks a newly arrived stored transfer and restores it when privacy is toggled back', () => {
    const props = {
      currentUserId: 'me',
      familyMembers: members,
      familyData: {},
      currencyCode: 'GBP' as const,
    };
    const { rerender } = render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <TransferArrivalMoment transactions={[]} {...props} />
      </MoneyPrivacyProvider>,
    );

    rerender(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <TransferArrivalMoment transactions={[tx({ id: 'private-arrival', amountPence: 76_543 })]} {...props} />
      </MoneyPrivacyProvider>,
    );
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('£765.43');

    act(() => screen.getByRole('button', { name: 'Hide money amounts' }).click());
    expect(screen.getByTestId('transfer-arrival-text')).not.toHaveTextContent('765.43');

    act(() => screen.getByRole('button', { name: 'Show money amounts' }).click());
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('£765.43');
  });

  it('never replays history on load or reload (baseline snapshot)', () => {
    const { rerender } = renderMoment([tx({ id: 't1' }), tx({ id: 't2' })]);
    rerender(
      <MoneyPrivacyProvider>
        <TransferArrivalMoment
          transactions={[tx({ id: 't1' }), tx({ id: 't2' })]}
          currentUserId="me"
          familyMembers={members}
          familyData={{}}
          currencyCode="GBP"
        />
      </MoneyPrivacyProvider>,
    );
    expect(screen.queryByTestId('transfer-arrival-moment')).not.toBeInTheDocument();
  });

  it('celebrates a transfer that arrives while the app is open, exactly once', () => {
    const { rerender } = renderMoment([]);
    expect(screen.queryByTestId('transfer-arrival-moment')).not.toBeInTheDocument();

    act(() => {
      rerender(
        <MoneyPrivacyProvider>
          <TransferArrivalMoment
            transactions={[tx({ id: 'new-1' })]}
            currentUserId="me"
            familyMembers={members}
            familyData={{}}
            currencyCode="GBP"
          />
        </MoneyPrivacyProvider>,
      );
    });
    expect(screen.getByTestId('transfer-arrival-moment')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('Ali');
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('£2.00');

    // The same document appearing again in a later snapshot must not re-fire.
    act(() => {
      rerender(
        <MoneyPrivacyProvider>
          <TransferArrivalMoment
            transactions={[tx({ id: 'new-1' })]}
            currentUserId="me"
            familyMembers={members}
            familyData={{}}
            currencyCode="GBP"
          />
        </MoneyPrivacyProvider>,
      );
    });
    expect(screen.getAllByTestId('transfer-arrival-moment')).toHaveLength(1);
  });

  it('ignores non-incoming ledger events (transfers out, deposits to others)', () => {
    const { rerender } = renderMoment([]);
    act(() => {
      rerender(
        <MoneyPrivacyProvider>
          <TransferArrivalMoment
            transactions={[
              tx({ id: 'out-1', type: 'transfer_out' }),
              tx({ id: 'dep-1', type: 'deposit' }),
              tx({ id: 'other-child', childId: 'ali' }),
            ]}
            currentUserId="me"
            familyMembers={members}
            familyData={{}}
            currencyCode="GBP"
          />
        </MoneyPrivacyProvider>,
      );
    });
    expect(screen.queryByTestId('transfer-arrival-moment')).not.toBeInTheDocument();
  });

  it('dismisses the moment', () => {
    const { rerender } = renderMoment([]);
    act(() => {
      rerender(
        <MoneyPrivacyProvider>
          <TransferArrivalMoment
            transactions={[tx({ id: 'new-1' })]}
            currentUserId="me"
            familyMembers={members}
            familyData={{}}
            currencyCode="GBP"
          />
        </MoneyPrivacyProvider>,
      );
    });
    act(() => {
      screen.getByTestId('transfer-arrival-dismiss').click();
    });
    expect(screen.queryByTestId('transfer-arrival-moment')).not.toBeInTheDocument();
  });
});
