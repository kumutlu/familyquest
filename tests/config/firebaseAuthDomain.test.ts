import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Firebase authentication domain', () => {
  it('keeps Google redirect storage same-origin on the custom domain', () => {
    const productionEnv = readFileSync('.env.production', 'utf8');
    const defaultEnv = readFileSync('.env', 'utf8');
    expect(productionEnv).toContain('VITE_FIREBASE_AUTH_DOMAIN=queki.app');
    expect(defaultEnv).toContain('VITE_FIREBASE_AUTH_DOMAIN=queki.app');
    expect(productionEnv).not.toContain('VITE_FIREBASE_AUTH_DOMAIN=familyquest-beta-402cb.firebaseapp.com');
  });
});
