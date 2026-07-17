import { afterEach, describe, expect, it, vi } from 'vitest';

describe('production build identifier', () => {
  afterEach(() => {
    vi.resetModules();
    delete window.__FAMILYQUEST_BUILD__;
  });

  it('publishes a non-secret git SHA and ISO build timestamp on window', async () => {
    const { FAMILYQUEST_BUILD } = await import('./buildInfo');

    expect(FAMILYQUEST_BUILD.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(FAMILYQUEST_BUILD.sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(new Date(FAMILYQUEST_BUILD.builtAt).toISOString()).toBe(FAMILYQUEST_BUILD.builtAt);
    expect(window.__FAMILYQUEST_BUILD__).toEqual(FAMILYQUEST_BUILD);
  });
});
