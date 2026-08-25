import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import { PendingTransfers } from './PendingTransfers';

const store = vi.hoisted(() => ({
  state: { currentUser: { id: 'child-private', familyId: 'family-private', role: 'child' } } as any,
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: (state: typeof store.state) => unknown) =>
    typeof selector === 'function' ? selector(store.state) : store.state,
}));

describe('PendingTransfers money privacy', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'wallet']);
    await i18n.changeLanguage('en');
  });

  it('masks an amount-bearing stored request message and restores it on toggle', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <PendingTransfers
          requests={[{
            id: 'request-private',
            amountPence: 59_208,
            toChildName: 'Alex',
            message: 'Lunch split £483.17',
            createdAt: new Date('2026-08-24T10:00:00Z'),
          }]}
        />
      </MoneyPrivacyProvider>,
    );

    expect(document.body).toHaveTextContent('£592.08');
    expect(document.body).toHaveTextContent('Lunch split £483.17');

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(document.body.innerHTML).not.toContain('592.08');
    expect(document.body.innerHTML).not.toContain('483.17');
    expect(screen.getAllByText('£••••')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));
    expect(document.body).toHaveTextContent('£592.08');
    expect(document.body).toHaveTextContent('Lunch split £483.17');
  });
});
