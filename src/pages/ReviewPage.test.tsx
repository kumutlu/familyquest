import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';
import { ReviewPage } from './ReviewPage';
import { ApprovalCenter } from '../components/parent/ApprovalCenter';
import { SwipeReview } from '../components/parent/SwipeReview';

let mockStoreState: any = {};
const listeners = new Set<() => void>();

vi.mock('../store/useStore', () => {
  const useStoreMock = (selector?: (state: any) => unknown) => {
    const [, setTick] = useState(0);
    useEffect(() => {
      const listener = () => setTick(t => t + 1);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);
    return selector ? selector(mockStoreState) : mockStoreState;
  };
  useStoreMock.getState = () => mockStoreState;
  useStoreMock.setState = (update: any) => {
    mockStoreState = typeof update === 'function' ? update(mockStoreState) : { ...mockStoreState, ...update };
    listeners.forEach(l => l());
  };
  return { useStore: useStoreMock };
});

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

const PROD_SHAPED_QR_REQUEST = {
  requestId: 'IeLTJeN6fwi4UY8tUO6H',
  qrSessionId: 'isuUAHgl2hyQRypeKxTM',
  familyId: 'fam1',
  requesterUid: null,
  requesterDisplayName: 'Test 1',
  requesterDeviceLabel: 'iPhone',
  category: 'join',
  type: 'child_qr_device_join',
  status: 'pending',
  createdAtMs: 1788501628126,
  expiresAtMs: 1788588028126,
  resolvedAtMs: null,
  resolvedBy: null,
  selectedManagedChildId: null,
  rejectionReason: null,
};

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
    bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'ready' },
    ...overrides,
  };
}

function updateStore(overrides: any) {
  act(() => {
    mockStoreState = {
      ...mockStoreState,
      ...overrides,
    };
    listeners.forEach(l => l());
  });
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

describe('ReviewPage & ApprovalCenter Hydration Regression Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    listeners.clear();
  });

  it('A. ReviewPage loading state suppresses false empty review state', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'loading' },
    });

    renderReviewPage(['/review']);

    expect(screen.getByTestId('review-page-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('swipe-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('swipe-review-caught-up')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 to review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/All caught up/i)).not.toBeInTheDocument();
  });

  it('B. Late hydration: transitions from loading [] to ready [request] WITHOUT remount', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'loading' },
    });

    renderReviewPage(['/review']);

    // Initially loading skeleton visible, no false empty state
    expect(screen.getByTestId('review-page-loading')).toBeInTheDocument();
    expect(screen.queryByText(/Test 1 wants to connect a device/i)).not.toBeInTheDocument();

    // Hydrate store asynchronously with production-shaped fixture
    updateStore({
      childQrJoinRequests: [PROD_SHAPED_QR_REQUEST],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'ready' },
    });

    // ApprovalCenter appears without page remount
    expect(screen.queryByTestId('review-page-loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pending \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText(/Test 1 wants to connect a device/i)).toBeInTheDocument();
    expect(screen.getByTestId('approve-qr-join-button')).toBeInTheDocument();
  });

  it('C. Ready empty: genuine empty state works when childQrJoinRequests is ready and empty', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'ready' },
    });

    renderReviewPage(['/review']);

    expect(screen.getByTestId('swipe-review')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('0');
    expect(screen.getByTestId('swipe-review-caught-up')).toBeInTheDocument();
  });

  it('D. Direct ApprovalCenter loading suppresses Pending (0) and shows loading indicator before ready', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'loading' },
    });

    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <ApprovalCenter />
        </MemoryRouter>
      </MoneyPrivacyProvider>
    );

    expect(screen.queryByRole('button', { name: /Pending \(0\)/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/You’re all caught up!/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('approval-center-loading')).toBeInTheDocument();

    // Hydrate store
    updateStore({
      childQrJoinRequests: [PROD_SHAPED_QR_REQUEST],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'ready' },
    });

    expect(screen.getByRole('button', { name: /Pending \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText(/Test 1 wants to connect a device/i)).toBeInTheDocument();
  });

  it('E. SwipeReview loading suppresses false caught-up state when childQrJoinRequests is loading', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'loading' },
    });

    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <SwipeReview />
        </MemoryRouter>
      </MoneyPrivacyProvider>
    );

    expect(screen.getByTestId('swipe-review-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('swipe-review')).not.toBeInTheDocument();
  });

  it('F. ApprovalCenter maps production request with requestId field properly', () => {
    mockStoreState = makeStore({
      childQrJoinRequests: [PROD_SHAPED_QR_REQUEST],
      bootstrapStatus: { tasks: 'ready', members: 'ready', childQrJoinRequests: 'ready' },
    });

    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <ApprovalCenter />
        </MemoryRouter>
      </MoneyPrivacyProvider>
    );

    expect(screen.getByText(/Test 1 wants to connect a device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pending \(1\)/i })).toBeInTheDocument();
  });
});
