import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';
import { ReviewPage } from './ReviewPage';
import { ApprovalCenter } from '../components/parent/ApprovalCenter';

let mockStoreState: any = {};

vi.mock('../store/useStore', () => ({
  useStore: (selector?: (state: any) => unknown) => {
    return selector ? selector(mockStoreState) : mockStoreState;
  },
}));

vi.mock('../lib/api', () => ({
  approveTaskCompletion: vi.fn(),
  rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(),
  rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(),
  rejectMoneyRequest: vi.fn(),
  mapApprovalError: vi.fn(),
}));

vi.mock('../lib/childQrOnboardingApi', () => ({
  approveChildQrJoinRequest: vi.fn(),
  rejectChildQrJoinRequest: vi.fn(),
}));

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'parent1', familyId: 'fam1', role: 'owner' },
    familyMembers: [
      { id: 'child1', displayName: 'Ali', role: 'child', isManaged: true },
    ],
    familyData: { id: 'fam1' },
    tasks: [],
    taskCompletions: [],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    profileUpdateRequests: [],
    goalRequests: [],
    savingsGoals: [],
    childJoinRequests: [],
    childQrJoinRequests: [],
    bootstrapStatus: { tasks: 'ready', members: 'ready' },
    ...overrides,
  };
}

function renderReviewPage(initialEntries = ['/review']) {
  return render(
    <MoneyPrivacyProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
    </MoneyPrivacyProvider>
  );
}

describe('ReviewPage Physical Bug Reproduction (RED TEST)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('RED TEST: ApprovalCenter fails to pass requestId as id when item only has requestId', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [
        {
          requestId: 'req_prod_test',
          status: 'pending',
          requesterDisplayName: 'Test',
          requesterDeviceLabel: 'iPhone',
        },
      ],
    });

    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <ApprovalCenter />
        </MemoryRouter>
      </MoneyPrivacyProvider>
    );

    // ApprovalCenter renders card, but item.id was undefined!
    expect(screen.getByText(/Test wants to connect a device/i)).toBeInTheDocument();
  });

  it('RED TEST: Notification click navigating to /review when childQrJoinRequests is empty/loading shows 0 to review and All caught up!', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
    });

    renderReviewPage(['/review']);

    // Reproduces physical failure: "0 to review" + "All caught up!"
    expect(screen.getByTestId('swipe-review')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('0');
    expect(screen.getByTestId('swipe-review-caught-up')).toBeInTheDocument();
    expect(screen.queryByText(/Test wants to connect a device/i)).not.toBeInTheDocument();
  });
});
