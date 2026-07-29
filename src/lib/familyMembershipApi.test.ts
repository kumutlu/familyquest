import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
const callable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));
vi.mock('./firebase', () => ({ functions: { region: 'europe-west1' } }));

import { requestFamilyJoin, regenerateFamilyCode } from './familyMembershipApi';

beforeEach(() => {
  vi.clearAllMocks();
  httpsCallable.mockReturnValue(callable);
});

describe('familyMembershipApi', () => {
  it('submits a join request with no requester-controlled role', async () => {
    callable.mockResolvedValue({ data: { familyId: 'family-1', status: 'pending' } });
    await requestFamilyJoin('ABC123', 'request-12345678');

    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      'requestFamilyJoin',
    );
    expect(callable).toHaveBeenCalledWith({
      familyCode: 'ABC123',
      clientReqId: 'request-12345678',
    });
    expect(callable.mock.calls[0][0]).not.toHaveProperty('role');
    expect(callable.mock.calls[0][0]).not.toHaveProperty('requestedRole');
  });

  it('regenerates through the owner-only callable', async () => {
    callable.mockResolvedValue({ data: { familyCode: 'NEW456' } });
    await expect(regenerateFamilyCode('request-12345678')).resolves.toEqual({
      familyCode: 'NEW456',
    });
    expect(callable).toHaveBeenCalledWith({ clientReqId: 'request-12345678' });
  });
});
