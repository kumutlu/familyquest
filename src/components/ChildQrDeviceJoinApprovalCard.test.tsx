import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChildQrDeviceJoinApprovalCard } from './ChildQrDeviceJoinApprovalCard';

describe('Task 8: Parent Approval Center Binding Card UI', () => {
  const mockManagedChildren = [
    { id: 'child-1', displayName: 'Ali' },
    { id: 'child-2', displayName: 'Ayse' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 46: parent approval card dropdown requires choosing an existing managed child', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);

    render(
      <ChildQrDeviceJoinApprovalCard
        request={{ id: 'req-qr-1', status: 'pending', sortDate: new Date() }}
        managedChildren={mockManagedChildren}
        onApprove={onApprove}
        onReject={onReject}
        isProcessing={false}
      />
    );

    expect(screen.getByTestId('child-selector-dropdown')).toBeInTheDocument();

    const approveBtn = screen.getByTestId('approve-qr-join-button');
    expect(approveBtn).toBeDisabled(); // Disabled until a child is selected

    // Select child-1 ("Ali")
    const dropdown = screen.getByTestId('child-selector-dropdown');
    fireEvent.change(dropdown, { target: { value: 'child-1' } });

    expect(approveBtn).not.toBeDisabled();
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith('child-1');
    });
  });

  it('allows rejecting without selecting a child', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn().mockResolvedValue(undefined);

    render(
      <ChildQrDeviceJoinApprovalCard
        request={{ id: 'req-qr-1', status: 'pending', sortDate: new Date() }}
        managedChildren={mockManagedChildren}
        onApprove={onApprove}
        onReject={onReject}
        isProcessing={false}
      />
    );

    const rejectBtn = screen.getByTestId('reject-qr-join-button');
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(onReject).toHaveBeenCalled();
    });
  });

  it('renders requesterDisplayName and device label in headline', () => {
    render(
      <ChildQrDeviceJoinApprovalCard
        request={{
          id: 'req-qr-1',
          status: 'pending',
          sortDate: new Date(),
          requesterDisplayName: 'Ali',
          requesterDeviceLabel: 'iPhone',
        }}
        managedChildren={mockManagedChildren}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isProcessing={false}
      />
    );

    expect(screen.getByTestId('qr-join-card-headline')).toHaveTextContent('Ali wants to connect a device');
    expect(screen.getByTestId('qr-join-card-device')).toHaveTextContent('iPhone • Waiting for approval');
  });

  it('renders HTML in requesterDisplayName safely as plain text node', () => {
    render(
      <ChildQrDeviceJoinApprovalCard
        request={{
          id: 'req-qr-1',
          status: 'pending',
          sortDate: new Date(),
          requesterDisplayName: '<script>alert("xss")</script>Ali',
        }}
        managedChildren={mockManagedChildren}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isProcessing={false}
      />
    );

    expect(screen.getByTestId('qr-join-card-headline')).toHaveTextContent('<script>alert("xss")</script>Ali wants to connect a device');
  });
});
