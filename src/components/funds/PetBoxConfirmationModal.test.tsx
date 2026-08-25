import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

const store = vi.hoisted(() => ({
  currentUser: { id: 'child-1' },
  familyData: { currencyCode: 'GBP' },
  myWallet: { balance: 9876 },
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: (state: typeof store) => unknown) =>
    typeof selector === 'function' ? selector(store) : store,
}));

import { PetBoxConfirmationModal } from './PetBoxConfirmationModal';

describe('PetBoxConfirmationModal money privacy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('masks current and resulting wallet balances but keeps the immediate donation visible', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <PetBoxConfirmationModal
          isOpen
          onClose={() => {}}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          amountPence={1234}
          fundName="Cat Box"
        />
      </MoneyPrivacyProvider>,
    );

    expect(screen.getByText('£98.76')).toBeInTheDocument();
    expect(screen.getByText('£86.42')).toBeInTheDocument();
    expect(screen.getByText('£12.34')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.queryByText('£98.76')).not.toBeInTheDocument();
    expect(screen.queryByText('£86.42')).not.toBeInTheDocument();
    expect(screen.getAllByText('£••••')).toHaveLength(2);
    expect(screen.getByText('£12.34')).toBeInTheDocument();
  });
});
