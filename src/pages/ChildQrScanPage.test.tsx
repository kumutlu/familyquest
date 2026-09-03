import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockScanToken = vi.fn();
const mockSubmitRequest = vi.fn();
const mockGetStatus = vi.fn();
const mockExchange = vi.fn();
const mockSignInWithCustomToken = vi.fn();

vi.mock('../lib/childQrOnboardingApi', () => ({
  scanChildQrToken: (t: string) => mockScanToken(t),
  submitChildQrJoinRequest: (t: string) => mockSubmitRequest(t),
  getChildQrJoinStatus: (h: any) => mockGetStatus(h),
  exchangeApprovedChildQrRequest: (h: any) => mockExchange(h),
  readQrJoinRequestHandle: vi.fn().mockReturnValue(null),
  storeQrJoinRequestHandle: vi.fn(),
  clearQrJoinRequestHandle: vi.fn(),
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
  });

  it('Test 47: child onboarding scan page allows entering QR token, submits join request, polls status, and exchanges token on approval', async () => {
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

    const input = screen.getByTestId('qr-token-input');
    fireEvent.change(input, { target: { value: 'valid-scanned-token' } });

    const submitBtn = screen.getByTestId('submit-qr-token-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockScanToken).toHaveBeenCalledWith('valid-scanned-token');
      expect(mockSubmitRequest).toHaveBeenCalledWith('valid-scanned-token');
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
});
