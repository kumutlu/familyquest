import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
const callable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));
vi.mock('./firebase', () => ({ functions: { region: 'europe-west1' } }));

import {
  ADULT_INVITATION_CONTRACT,
  acceptAdultInvitation,
  completeAdultInvitationProfile,
  createAdultInvitation,
  previewAdultInvitation,
  revokeAdultInvitation,
} from './adultInvitationApi';

beforeEach(() => {
  vi.clearAllMocks();
  httpsCallable.mockReturnValue(callable);
});

describe('adultInvitationApi', () => {
  it('fails closed when the shared authority contract is mutated to allow family-code fallback', async () => {
    const contract = ADULT_INVITATION_CONTRACT as {
      adultMembershipAuthority: string;
      familyCodeAdultAuthorityFallback: boolean;
    };
    const original = { ...contract };
    contract.adultMembershipAuthority = 'family-code';
    contract.familyCodeAdultAuthorityFallback = true;

    await expect(createAdultInvitation({
      intendedRole: 'parent',
      clientReqId: 'request-contract-mutation',
    })).rejects.toThrow(/adult invitation authority contract is not safe/);
    expect(httpsCallable).not.toHaveBeenCalled();

    Object.assign(contract, original);
  });

  it('mirrors the creation callable contract exactly', async () => {
    const result = {
      invitationId: 'a'.repeat(64),
      token: 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws',
      intendedRole: 'parent' as const,
      expiresAt: '2026-09-02T12:00:00.000Z',
    };
    callable.mockResolvedValue({ data: result });

    await expect(createAdultInvitation({
      intendedRole: 'parent',
      clientReqId: 'request-create-1',
    })).resolves.toEqual(result);

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'createAdultInvitation',
    );
    expect(callable).toHaveBeenCalledWith({
      intendedRole: 'parent',
      clientReqId: 'request-create-1',
    });
  });

  it('previews with the raw token as the only input', async () => {
    const token = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
    const result = {
      familyDisplayName: 'The Smiths',
      intendedRole: 'adult' as const,
      expiresAt: '2026-09-02T12:00:00.000Z',
      status: 'active' as const,
    };
    callable.mockResolvedValue({ data: result });

    await expect(previewAdultInvitation({ token })).resolves.toEqual(result);

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'previewAdultInvitation',
    );
    expect(callable).toHaveBeenCalledWith({ token });
  });

  it('accepts with no client-selected family or role', async () => {
    const token = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
    const result = {
      result: 'joined' as const,
      familyId: 'family-1',
      role: 'parent' as const,
      destination: '/' as const,
    };
    callable.mockResolvedValue({ data: result });

    await expect(acceptAdultInvitation({
      token,
      clientReqId: 'request-accept-1',
    })).resolves.toEqual(result);

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'acceptAdultInvitation',
    );
    const payload = callable.mock.calls[0][0];
    expect(payload).toEqual({ token, clientReqId: 'request-accept-1' });
    expect(payload).not.toHaveProperty('familyId');
    expect(payload).not.toHaveProperty('role');
  });

  it('repairs a minimal invite profile without client-selected authority', async () => {
    callable.mockResolvedValue({ data: { success: true } });
    const token = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';

    await expect(completeAdultInvitationProfile({
      token,
      displayName: 'Alex Smith',
      clientReqId: 'request-profile-1',
    })).resolves.toEqual({ success: true });

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'completeAdultInvitationProfile',
    );
    const payload = callable.mock.calls[0][0];
    expect(payload).toEqual({
      token,
      displayName: 'Alex Smith',
      clientReqId: 'request-profile-1',
    });
    expect(payload).not.toHaveProperty('familyId');
    expect(payload).not.toHaveProperty('role');
  });

  it('revokes by safe invitation id and request id only', async () => {
    callable.mockResolvedValue({ data: { success: true } });

    await expect(revokeAdultInvitation({
      invitationId: 'a'.repeat(64),
      clientReqId: 'request-revoke-1',
    })).resolves.toEqual({ success: true });

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'revokeAdultInvitation',
    );
    expect(callable).toHaveBeenCalledWith({
      invitationId: 'a'.repeat(64),
      clientReqId: 'request-revoke-1',
    });
  });
});
