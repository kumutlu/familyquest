import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn(), cancelPendingApproval: vi.fn() }));
vi.mock('../../lib/reversalApi', () => ({ reverseTransaction: api.reverseTransaction }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: api.cancelPendingApproval }));

const today = new Date();
today.setHours(8, 15, 0, 0);

vi.mock('../../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    familyData: { currency: '£' },
    familyMembers: [{ id: 'child-1', displayName: 'Alisya', rewardPoints: 20 }],
    childWallets: [{ id: 'child-1', balance: 500 }],
    funds: [],
    reversals: [],
    walletTransactions: [],
    fundTransactions: [],
    behaviourEvents: [],
    taskCompletions: [{
      id: 'comp-1',
      taskId: 'task-1',
      assigneeId: 'child-1',
      awardedPoints: 10,
      reviewedByName: 'Kemal',
      status: 'approved',
      createdAt: today,
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'task_completion',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        pointsDelta: 10,
      },
    }],
    redemptions: [],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    tasks: [{ id: 'task-1', title: 'Brush teeth morning' }],
    rewards: [],
  }),
}));

import { ReversalHistoryPanel } from './ReversalHistoryPanel';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

describe('ReversalHistoryPanel attribution', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.loadNamespaces(['reversals']);
    await i18n.changeLanguage('en');
    api.reverseTransaction.mockResolvedValue({ status: 'completed' });
  });

  it('shows the child, task, points, approver and timestamp for a completion', () => {
    render(<ReversalHistoryPanel />);
    // Child who completed it is named, not just the approver.
    expect(screen.getByText('Alisya completed')).toBeInTheDocument();
    // Task name is shown as the title line.
    expect(screen.getByText('Brush teeth morning')).toBeInTheDocument();
    // Points earned are shown.
    expect(screen.getByText('+10 Points')).toBeInTheDocument();
    // Approver is shown when available.
    expect(screen.getByText('Approved by Kemal')).toBeInTheDocument();
    // A timestamp is rendered alongside the source kind.
    const meta = screen.getByText(/task completion/i);
    expect(meta.textContent).toMatch(/•/);
  });

  it('keeps the existing Undo action working (no business logic change)', async () => {
    render(<ReversalHistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText('Reversed')).toBeInTheDocument());
    expect(api.reverseTransaction).toHaveBeenCalledTimes(1);
  });
});
