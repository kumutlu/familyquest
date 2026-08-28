import { describe, expect, it } from 'vitest';

import {
  adultInviteCallableEndpoint,
  readCallableResult,
} from './e2e/utils/adultInvite';

describe('adult invitation E2E callable boundary', () => {
  it('targets the emulator callable endpoint without embedding a token', () => {
    expect(adultInviteCallableEndpoint('createAdultInvitation')).toBe(
      'http://127.0.0.1:5001/familyquest-beta-402cb/europe-west1/createAdultInvitation',
    );
  });

  it('accepts only a callable result payload, never an arbitrary response body', () => {
    expect(readCallableResult<{ invitationId: string }>({ result: { invitationId: 'a'.repeat(64) } })).toEqual({
      invitationId: 'a'.repeat(64),
    });
    expect(() => readCallableResult({ data: { invitationId: 'a'.repeat(64) } })).toThrow('CALLABLE_RESPONSE_INVALID');
  });
});
