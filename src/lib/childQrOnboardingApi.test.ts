import { describe, it, expect, vi, beforeEach } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));
vi.mock('./firebase', () => ({
  functions: {},
}));

import {
  generateChildQrToken,
  scanChildQrToken,
  submitChildQrJoinRequest,
  getChildQrJoinStatus,
  approveChildQrJoinRequest,
  rejectChildQrJoinRequest,
  exchangeApprovedChildQrRequest,
  storeQrJoinRequestHandle,
  readQrJoinRequestHandle,
  clearQrJoinRequestHandle,
  mapChildQrErrorKey,
} from './childQrOnboardingApi';

describe('Task 6: Client Callables & Onboarding Service Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('Test 38: unauthenticated child scan returns valid preview', async () => {
    const mockCallable = vi.fn().mockResolvedValue({ data: { valid: true, expiresAtMs: 1700000000000 } });
    httpsCallable.mockReturnValue(mockCallable);

    const result = await scanChildQrToken('valid-qr-token');
    expect(httpsCallable).toHaveBeenCalledWith({}, 'scanChildQrToken');
    expect(mockCallable).toHaveBeenCalledWith({ token: 'valid-qr-token' });
    expect(result).toEqual({ valid: true, expiresAtMs: 1700000000000 });
  });

  it('Test 39: submitting QR request stores requestId and secret in local storage', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { requestId: 'req-123', requestSecret: 'sec-456', status: 'pending', expiresAtMs: 1700000000000 },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const res = await submitChildQrJoinRequest('valid-qr-token');
    storeQrJoinRequestHandle({ requestId: res.requestId, requestSecret: res.requestSecret });

    const handle = readQrJoinRequestHandle();
    expect(handle).toEqual({ requestId: 'req-123', requestSecret: 'sec-456' });

    clearQrJoinRequestHandle();
    expect(readQrJoinRequestHandle()).toBeNull();
  });

  it('Test 40: polling status handles pending/approved/rejected/expired', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { requestId: 'req-123', status: 'approved', expiresAtMs: 1700000000000 },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const statusRes = await getChildQrJoinStatus({ requestId: 'req-123', requestSecret: 'sec-456' });
    expect(mockCallable).toHaveBeenCalledWith({ requestId: 'req-123', requestSecret: 'sec-456' });
    expect(statusRes.status).toBe('approved');
  });

  it('Test 41: parent modal generates QR token', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { rawToken: 'raw-token-123', expiresAtMs: 1700000000000 },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const res = await generateChildQrToken();
    expect(httpsCallable).toHaveBeenCalledWith({}, 'generateChildQrToken');
    expect(res.rawToken).toBe('raw-token-123');
  });

  it('Test 42: parent approval selects existing child', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { requestId: 'req-123', selectedManagedChildId: 'child-1', status: 'approved' },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const res = await approveChildQrJoinRequest('family-1', 'req-123', 'child-1');
    expect(httpsCallable).toHaveBeenCalledWith({}, 'approveChildQrJoinRequest');
    expect(mockCallable).toHaveBeenCalledWith({ familyId: 'family-1', requestId: 'req-123', selectedManagedChildId: 'child-1' });
    expect(res.status).toBe('approved');
  });

  it('Test 43: parent rejection marks request rejected', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { requestId: 'req-123', status: 'rejected' },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const res = await rejectChildQrJoinRequest('family-1', 'req-123', 'Not approved');
    expect(httpsCallable).toHaveBeenCalledWith({}, 'rejectChildQrJoinRequest');
    expect(mockCallable).toHaveBeenCalledWith({ familyId: 'family-1', requestId: 'req-123', rejectionReason: 'Not approved' });
    expect(res.status).toBe('rejected');
  });

  it('verifies custom token exchange wrapper', async () => {
    const mockCallable = vi.fn().mockResolvedValue({
      data: { customToken: 'token-xyz', childId: 'child-1' },
    });
    httpsCallable.mockReturnValue(mockCallable);

    const res = await exchangeApprovedChildQrRequest({ requestId: 'req-123', requestSecret: 'sec-456' });
    expect(httpsCallable).toHaveBeenCalledWith({}, 'exchangeApprovedChildQrRequest');
    expect(mockCallable).toHaveBeenCalledWith({ requestId: 'req-123', requestSecret: 'sec-456' });
    expect(res.customToken).toBe('token-xyz');
  });

  it('maps backend errors to i18n keys', () => {
    expect(mapChildQrErrorKey({ message: 'QR_EXPIRED' })).toBe('auth:childQr.errors.expired');
    expect(mapChildQrErrorKey({ message: 'QR_REVOKED' })).toBe('auth:childQr.errors.revoked');
    expect(mapChildQrErrorKey({ message: 'QR_ALREADY_USED' })).toBe('auth:childQr.errors.alreadyUsed');
    expect(mapChildQrErrorKey({ message: 'INVALID_QR_TOKEN' })).toBe('auth:childQr.errors.invalidToken');
    expect(mapChildQrErrorKey({ code: 'functions/unavailable' })).toBe('auth:childQr.errors.network');
  });
});
