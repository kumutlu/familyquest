import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n/config';
import enErrors from '../i18n/locales/en/errors.json';
import { mapChildLoginError } from './childLoginApi';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('errors');
});

afterEach(() => {
  i18n.addResourceBundle('en', 'errors', enErrors, true, true);
});

describe('mapChildLoginError', () => {
  it('maps a duplicate username from a Firebase callable error', () => {
    expect(
      mapChildLoginError({
        code: 'functions/already-exists',
        message: 'USERNAME_TAKEN',
      }),
    ).toBe('That username is already taken in this family.');
  });

  it('maps backend validation errors', () => {
    expect(
      mapChildLoginError({
        code: 'functions/invalid-argument',
        message: 'USERNAME_LENGTH',
      }),
    ).toBe('Username must be 3–32 characters.');
  });

  it('maps permission denied errors', () => {
    expect(
      mapChildLoginError({
        code: 'functions/permission-denied',
        message: 'NOT_AUTHORIZED',
      }),
    ).toBe('You do not have permission to do this.');
  });

  it('maps an unexpected server error without exposing server details', () => {
    expect(
      mapChildLoginError({
        code: 'functions/internal',
        message: 'FirebaseError: an internal error occurred',
      }),
    ).toBe('We could not create the login. Please try again.');
  });

  it('never returns a raw translation key when the namespace or key is missing', () => {
    i18n.removeResourceBundle('en', 'errors');

    expect(
      mapChildLoginError({
        code: 'functions/internal',
        message: 'AUTH_CREATE_FAILED',
      }),
    ).toBe('We could not create the login. Please try again.');
  });
});
