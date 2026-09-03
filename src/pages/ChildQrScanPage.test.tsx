import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockScanToken = vi.fn();
const mockSubmitRequest = vi.fn();
const mockGetStatus = vi.fn();
const mockExchange = vi.fn();
const mockSignInWithCustomToken = vi.fn();

const mockReadHandle = vi.fn();
const mockClearHandle = vi.fn();
const mockStoreHandle = vi.fn();

vi.mock('../lib/childQrOnboardingApi', () => ({
  scanChildQrToken: (t: string) => mockScanToken(t),
  submitChildQrJoinRequest: (t: string, name: string, dev?: string) => mockSubmitRequest(t, name, dev),
  getChildQrJoinStatus: (h: any) => mockGetStatus(h),
  exchangeApprovedChildQrRequest: (h: any) => mockExchange(h),
  readQrJoinRequestHandle: () => mockReadHandle(),
  storeQrJoinRequestHandle: (h: any) => mockStoreHandle(h),
  clearQrJoinRequestHandle: () => mockClearHandle(),
  mapChildQrErrorKey: (e: any) => e?.message || 'Error',
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  signInWithCustomToken: (...args: any[]) => mockSignInWithCustomToken(...args),
}));
vi.mock('../lib/firebase', () => ({
  auth: {},
}));

import { ChildQrScanPage } from './ChildQrScanPage';

describe('Task 9: Child Onboarding Scan & Waiting UI Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadHandle.mockReturnValue(null);
  });

  it('Test 47: child onboarding scan page allows entering name and QR token, submits join request, polls status, and exchanges token on approval', async () => {
    mockScanToken.mockResolvedValue({ valid: true, expiresAtMs: Date.now() + 900000 });
    mockSubmitRequest.mockResolvedValue({
      requestId: 'req-qr-100',
      requestSecret: 'secret-100',
      status: 'pending',
      expiresAtMs: Date.now() + 86400000,
    });
    mockGetStatus.mockResolvedValue({
      requestId: 'req-qr-100',
      status: 'approved',
      expiresAtMs: Date.now() + 86400000,
    });
    mockExchange.mockResolvedValue({
      customToken: 'custom-token-existing-child-auth-uid',
      childId: 'child-1',
    });
    mockSignInWithCustomToken.mockResolvedValue({ user: { uid: 'existing-child-auth-uid' } });

    render(
      <MemoryRouter initialEntries={['/join-qr']}>
        <ChildQrScanPage />
      </MemoryRouter>
    );

    const nameInput = screen.getByTestId('qr-display-name-input');
    fireEvent.change(nameInput, { target: { value: 'Ali' } });

    const input = screen.getByTestId('qr-token-input');
    fireEvent.change(input, { target: { value: 'valid-scanned-token' } });

    const submitBtn = screen.getByTestId('submit-qr-token-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockScanToken).toHaveBeenCalledWith('valid-scanned-token');
      expect(mockSubmitRequest).toHaveBeenCalledWith('valid-scanned-token', 'Ali', expect.any(String));
    });

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledWith({
        requestId: 'req-qr-100',
        requestSecret: 'secret-100',
      });
    });

    await waitFor(() => {
      expect(mockExchange).toHaveBeenCalledWith({
        requestId: 'req-qr-100',
        requestSecret: 'secret-100',
      });
      expect(mockSignInWithCustomToken).toHaveBeenCalled();
    });
  });

  it('Regression A & C: saved pending handle exists + URL contains fresh token -> saved request is NOT polled, old handle cleared, name form appears, submitting replaces handle', async () => {
    mockReadHandle.mockReturnValue({
      requestId: 'old-stale-request-id',
      requestSecret: 'old-stale-secret',
    });
    mockScanToken.mockResolvedValue({ valid: true, expiresAtMs: Date.now() + 900000 });
    mockSubmitRequest.mockResolvedValue({
      requestId: 'new-fresh-request-id',
      requestSecret: 'new-fresh-secret',
      status: 'pending',
      expiresAtMs: Date.now() + 86400000,
    });
    mockGetStatus.mockResolvedValue({
      requestId: 'new-fresh-request-id',
      status: 'pending',
      expiresAtMs: Date.now() + 86400000,
    });

    render(
      <MemoryRouter initialEntries={['/join-qr?token=fresh-scanned-token']}>
        <ChildQrScanPage />
      </MemoryRouter>
    );

    // Old handle must NOT be polled
    expect(mockGetStatus).not.toHaveBeenCalledWith(expect.objectContaining({ requestId: 'old-stale-request-id' }));

    // Name-entry UI MUST appear
    const nameInput = await screen.findByTestId('qr-display-name-input');
    expect(nameInput).toBeInTheDocument();
    expect(screen.queryByText('Waiting for Parent Approval')).not.toBeInTheDocument();

    // Old handle must be cleared
    expect(mockClearHandle).toHaveBeenCalled();

    // User enters name and submits
    fireEvent.change(nameInput, { target: { value: 'Ali' } });
    const submitBtn = screen.getByTestId('submit-qr-token-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockScanToken).toHaveBeenCalledWith('fresh-scanned-token');
      expect(mockSubmitRequest).toHaveBeenCalledWith('fresh-scanned-token', 'Ali', expect.any(String));
      expect(mockStoreHandle).toHaveBeenCalledWith({
        requestId: 'new-fresh-request-id',
        requestSecret: 'new-fresh-secret',
      });
    });

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledWith({
        requestId: 'new-fresh-request-id',
        requestSecret: 'new-fresh-secret',
      });
      expect(screen.getByText('Waiting for Parent Approval')).toBeInTheDocument();
    });
  });

  it('Regression B: URL has NO token + saved handle exists -> saved handle restores and polling resumes in waiting state', async () => {
    mockReadHandle.mockReturnValue({
      requestId: 'valid-saved-request-id',
      requestSecret: 'valid-saved-secret',
    });
    mockGetStatus.mockResolvedValue({
      requestId: 'valid-saved-request-id',
      status: 'pending',
      expiresAtMs: Date.now() + 86400000,
    });

    render(
      <MemoryRouter initialEntries={['/join-qr']}>
        <ChildQrScanPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledWith({
        requestId: 'valid-saved-request-id',
        requestSecret: 'valid-saved-secret',
      });
      expect(screen.getByText('Waiting for Parent Approval')).toBeInTheDocument();
    });
  });

  it('Regression D: Scan another QR button stops polling, clears local handle, leaves waiting UI, performs zero server cancellation', async () => {
    mockReadHandle.mockReturnValue({
      requestId: 'valid-saved-request-id',
      requestSecret: 'valid-saved-secret',
    });
    mockGetStatus.mockResolvedValue({
      requestId: 'valid-saved-request-id',
      status: 'pending',
      expiresAtMs: Date.now() + 86400000,
    });

    render(
      <MemoryRouter initialEntries={['/join-qr']}>
        <ChildQrScanPage />
      </MemoryRouter>
    );

    await screen.findByText('Waiting for Parent Approval');
    const scanAnotherBtn = screen.getByTestId('scan-another-qr-button');
    fireEvent.click(scanAnotherBtn);

    expect(mockClearHandle).toHaveBeenCalled();
    expect(screen.queryByText('Waiting for Parent Approval')).not.toBeInTheDocument();
    expect(screen.getByTestId('qr-display-name-input')).toBeInTheDocument();
  });
});
