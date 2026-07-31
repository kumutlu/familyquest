import { afterEach, describe, expect, it } from 'vitest';
import i18n, { NAMESPACES } from './config';

const ORIGINAL_LANGUAGE = i18n.language;

afterEach(async () => {
  await i18n.changeLanguage(ORIGINAL_LANGUAGE);
  for (const ns of NAMESPACES) {
    if (ns === 'common') continue;
    i18n.removeResourceBundle('en', ns);
    i18n.removeResourceBundle('tr', ns);
  }
});

describe('i18n auth namespace — English rendering', () => {
  it('returns English strings for auth keys', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:signIn')).toBe('Sign in');
    expect(i18n.t('auth:signUp')).toBe('Sign up');
    expect(i18n.t('auth:signOut')).toBe('Sign out');
    expect(i18n.t('auth:email')).toBe('Email');
    expect(i18n.t('auth:password')).toBe('Password');
    expect(i18n.t('auth:emailAddress')).toBe('Email address');
    expect(i18n.t('auth:familyCode')).toBe('Family Code');
    expect(i18n.t('auth:username')).toBe('Username');
    expect(i18n.t('auth:signInWithGoogle')).toBe('Sign in with Google');
    expect(i18n.t('auth:continueWithGoogle')).toBe('Continue with Google');
  });

  it('interpolates the app name into auth titles', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:signInTitle', { appName: 'Queki' })).toBe('Sign in to Queki');
    expect(i18n.t('auth:welcome', { appName: 'Queki' })).toBe('Welcome to Queki');
  });

  it('interpolates step counts', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:stepOf', { current: 1, total: 3 })).toBe('Step 1 of 3');
    expect(i18n.t('auth:stepOf', { current: 2, total: 3 })).toBe('Step 2 of 3');
  });
});

describe('i18n auth namespace — Turkish rendering', () => {
  it('returns Turkish strings for auth keys', async () => {
    await i18n.loadNamespaces(['auth']);
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:signIn')).toBe('Giriş yap');
    expect(i18n.t('auth:signUp')).toBe('Kaydol');
    expect(i18n.t('auth:signOut')).toBe('Çıkış yap');
    expect(i18n.t('auth:email')).toBe('E-posta');
    expect(i18n.t('auth:password')).toBe('Şifre');
    expect(i18n.t('auth:emailAddress')).toBe('E-posta adresi');
    expect(i18n.t('auth:familyCode')).toBe('Aile Kodu');
    expect(i18n.t('auth:username')).toBe('Kullanıcı adı');
    expect(i18n.t('auth:signInWithGoogle')).toBe('Google ile giriş yap');
    expect(i18n.t('auth:continueWithGoogle')).toBe('Google ile devam et');
  });

  it('interpolates the app name into auth titles (Turkish)', async () => {
    await i18n.loadNamespaces(['auth']);
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:signInTitle', { appName: 'Queki' })).toBe('Queki\'e giriş yap');
    expect(i18n.t('auth:welcome', { appName: 'Queki' })).toBe('Queki\'e hoş geldiniz');
  });

  it('interpolates step counts (Turkish)', async () => {
    await i18n.loadNamespaces(['auth']);
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:stepOf', { current: 1, total: 3 })).toBe('3 adımdan 1. adım');
  });
});

describe('i18n auth namespace — language switching', () => {
  it('switches between English and Turkish for the same key', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:signIn')).toBe('Sign in');
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:signIn')).toBe('Giriş yap');
    await i18n.changeLanguage('en');
    expect(i18n.t('auth:signIn')).toBe('Sign in');
  });
});

describe('i18n auth namespace — validation messages', () => {
  it('exposes the child required-fields validation message', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:childFieldsRequired')).toBe(
      'Please enter your Family Code, username, and password.',
    );
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:childFieldsRequired')).toBe(
      'Lütfen Aile Kodunuzu, kullanıcı adınızı ve şifrenizi girin.',
    );
  });

  it('exposes the invalid invite/claim code validation message', async () => {
    await i18n.loadNamespaces(['auth']);
    expect(i18n.t('auth:invalidInviteOrClaimCode')).toBe('Invalid invite or claim code');
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:invalidInviteOrClaimCode')).toBe('Geçersiz davet veya talep kodu');
  });
});

describe('i18n common namespace — shared dialog/toast/button labels', () => {
  it('exposes shared labels in English and Turkish', () => {
    expect(i18n.t('common:closeDialog')).toBe('Close dialog');
    expect(i18n.t('common:dismissNotification')).toBe('Dismiss notification');
    expect(i18n.t('common:back')).toBe('Back');
    expect(i18n.t('common:continue')).toBe('Continue');
  });

  it('exposes shared labels in Turkish', async () => {
    await i18n.changeLanguage('tr');
    expect(i18n.t('common:closeDialog')).toBe('Kapat');
    expect(i18n.t('common:dismissNotification')).toBe('Bildirimi kapat');
    expect(i18n.t('common:back')).toBe('Geri');
    expect(i18n.t('common:continue')).toBe('Devam et');
  });
});