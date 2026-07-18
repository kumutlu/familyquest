import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(), rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),
}));
const state = vi.hoisted(() => ({ current: {} as any }));

vi.mock('../../../lib/api', () => api);
vi.mock('../../../store/useStore', () => ({ useStore: () => state.current }));
vi.mock('../../../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));

import { PendingApprovalsSection } from './PendingApprovalsSection';

describe('PendingApprovalsSection', () => {
  it('renders pending approvals from existing store data', () => {
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [{ id: 'task-1', title: 'Tidy room', pointsReward: 10 }],
      familyMembers: [{ id: 'child-1', displayName: 'Ada' }],
      taskCompletions: [{ id: 'tc-1', taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' }],
      transferRequests: [], moneyRequests: [], petboxRequests: [],
    };
    render(<PendingApprovalsSection />);
    expect(screen.getByText(/Tidy room/)).toBeInTheDocument();
    expect(screen.getByText(/Ada completed/)).toBeInTheDocument();
  });

  it('renders the empty approval state when there are no pending items', () => {
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [], familyMembers: [],
      taskCompletions: [], transferRequests: [], moneyRequests: [], petboxRequests: [],
    };
    render(<PendingApprovalsSection />);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });
});
