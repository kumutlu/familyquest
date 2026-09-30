import { describe, expect, it } from 'vitest';
import { EMAIL_ACTION_CONTINUE_PATH, parseEmailAction, parseVerificationAction } from './emailActionHandler';

describe('parseVerificationAction', () => {
  it('accepts only a Firebase verifyEmail action with a non-empty code', () => {
    expect(parseVerificationAction('?mode=verifyEmail&oobCode=one-time-code&lang=tr')).toEqual({
      kind: 'verifyEmail',
      oobCode: 'one-time-code',
      locale: 'tr',
    });
    expect(parseVerificationAction('?mode=resetPassword&oobCode=one-time-code')).toEqual({ kind: 'invalid' });
    expect(parseVerificationAction('?mode=verifyEmail&oobCode=')).toEqual({ kind: 'invalid' });
    expect(parseVerificationAction('?oobCode=one-time-code')).toEqual({ kind: 'invalid' });
  });

  it('falls back to English for unsupported or malformed locale values', () => {
    expect(parseVerificationAction('?mode=verifyEmail&oobCode=code&lang=fr')).toMatchObject({ locale: 'en' });
    expect(parseVerificationAction('?mode=verifyEmail&oobCode=code&lang=%00tr')).toMatchObject({ locale: 'en' });
  });

  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    'https://queki.app.evil.example/verify-email',
    'https://queki.app@evil.example/verify-email',
    'javascript:alert(1)',
    'https%3A%2F%2Fevil.example%2Fsteal',
  ])('never lets hostile continueUrl %s control the successful destination', continueUrl => {
    const parsed = parseVerificationAction(
      `?mode=verifyEmail&oobCode=code&continueUrl=${encodeURIComponent(continueUrl)}`,
    );
    expect(parsed).toMatchObject({ kind: 'verifyEmail', oobCode: 'code' });
    expect(EMAIL_ACTION_CONTINUE_PATH).toBe('/verify-email');
  });
});

describe('parseEmailAction', () => {
  it.each(['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail', 'revertSecondFactorAddition'])('accepts supported mode %s', mode => {
    expect(parseEmailAction(`?mode=${mode}&oobCode=code`)).toMatchObject({ kind: mode, oobCode: 'code' });
  });

  it('fails closed for unsupported modes and missing codes', () => {
    expect(parseEmailAction('?mode=signIn&oobCode=code')).toEqual({ kind: 'invalid' });
    expect(parseEmailAction('?mode=verifyEmail')).toEqual({ kind: 'invalid' });
  });
});
