import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
const callable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));
vi.mock('./firebase', () => ({ functions: { region: 'europe-west1' } }));

import { acceptInvitation, createFamilyInvitation, previewInvitation } from './familyInvitationApi';

beforeEach(() => {
  vi.clearAllMocks();
  httpsCallable.mockReturnValue(callable);
});

describe('familyInvitationApi', () => {
  it('creates a parent invitation through the trusted callable', async () => {
    callable.mockResolvedValue({ data: { code: '7ZXWRZ', intendedRole: 'parent', expiresAtMs: 1 } });

    await expect(createFamilyInvitation('parent', 'request-12345678')).resolves.toEqual({
      code: '7ZXWRZ',
      intendedRole: 'parent',
      expiresAtMs: 1,
    });
    expect(httpsCallable).toHaveBeenCalledWith({ region: 'europe-west1' }, 'createFamilyInvitation');
    expect(callable).toHaveBeenCalledWith({ intendedRole: 'parent', clientReqId: 'request-12345678' });
  });

  it('creates a child invitation through the trusted callable', async () => {
    callable.mockResolvedValue({ data: { code: 'CHILD1', intendedRole: 'child', expiresAtMs: 1 } });
    await createFamilyInvitation('child', 'request-12345678');
    expect(callable).toHaveBeenCalledWith({ intendedRole: 'child', clientReqId: 'request-12345678' });
  });

  it('previews an invitation using only the code', async () => {
    callable.mockResolvedValue({ data: { familyName: 'The Smiths', intendedRole: 'child' } });

    await expect(previewInvitation('7ZXWRZ')).resolves.toEqual({
      familyName: 'The Smiths',
      intendedRole: 'child',
    });
    expect(callable).toHaveBeenCalledWith({ code: '7ZXWRZ' });
  });

  it('accepts an invitation without ever sending a role', async () => {
    callable.mockResolvedValue({ data: { familyId: 'family-1', status: 'pending', intendedRole: 'child' } });

    await acceptInvitation('7ZXWRZ', 'request-12345678');

    expect(httpsCallable).toHaveBeenCalledWith({ region: 'europe-west1' }, 'acceptInvitation');
    expect(callable).toHaveBeenCalledWith({ code: '7ZXWRZ', clientReqId: 'request-12345678' });
    const payload = callable.mock.calls[0][0];
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('type');
    expect(payload).not.toHaveProperty('intendedRole');
  });
});
