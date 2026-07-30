import { describe, it, expect } from 'vitest';
import { getLegalLinks, normaliseLegalUrl } from './legalLinks';

describe('legalLinks', () => {
  it('exposes each configured absolute URL', () => {
    expect(getLegalLinks({
      VITE_PRIVACY_POLICY_URL: 'https://queki.app/privacy',
      VITE_TERMS_URL: 'https://queki.app/terms',
      VITE_ACCOUNT_DELETION_URL: 'https://queki.app/delete-account',
    })).toEqual({
      privacyPolicy: 'https://queki.app/privacy',
      terms: 'https://queki.app/terms',
      accountDeletion: 'https://queki.app/delete-account',
    });
  });

  it('treats missing or blank variables as not configured', () => {
    expect(getLegalLinks({ VITE_TERMS_URL: '   ' })).toEqual({
      privacyPolicy: null,
      terms: null,
      accountDeletion: null,
    });
  });

  it.each([
    'javascript:alert(1)',
    'not-a-url',
    '/privacy',
    'ftp://queki.app/privacy',
    42,
    null,
    undefined,
  ])('rejects the unsafe or relative value %p', value => {
    expect(normaliseLegalUrl(value)).toBeNull();
  });

  it('keeps http URLs for local/staging deployments', () => {
    expect(normaliseLegalUrl('http://localhost:5173/privacy')).toBe('http://localhost:5173/privacy');
  });
});
