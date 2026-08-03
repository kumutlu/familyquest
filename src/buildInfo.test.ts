import packageJsonRaw from '../package.json?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('production build identifier', () => {
  afterEach(() => {
    vi.resetModules();
    delete window.__FAMILYQUEST_BUILD__;
  });

  it('publishes a non-secret git SHA and ISO build timestamp on window', async () => {
    const { FAMILYQUEST_BUILD } = await import('./buildInfo');

    expect(FAMILYQUEST_BUILD.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(FAMILYQUEST_BUILD.sha).toMatch(/^([0-9a-f]{7,40}|unknown)$/);
    expect(new Date(FAMILYQUEST_BUILD.builtAt).toISOString()).toBe(FAMILYQUEST_BUILD.builtAt);
    expect(window.__FAMILYQUEST_BUILD__).toEqual(FAMILYQUEST_BUILD);
  });

  it('sources the version from package.json rather than a 0.0.0 fallback', async () => {
    const { FAMILYQUEST_BUILD } = await import('./buildInfo');
    const pkg = JSON.parse(packageJsonRaw) as { version: string };

    expect(FAMILYQUEST_BUILD.version).toBe(pkg.version);
    expect(FAMILYQUEST_BUILD.version).not.toBe('0.0.0');
  });

  it('exposes only the non-secret Firebase project ID and an environment label', async () => {
    const { FAMILYQUEST_BUILD } = await import('./buildInfo');

    expect(['DEVELOPMENT', 'PREVIEW', 'PRODUCTION']).toContain(FAMILYQUEST_BUILD.environment);
    expect(typeof FAMILYQUEST_BUILD.firebaseProjectId).toBe('string');
    expect(FAMILYQUEST_BUILD.firebaseProjectId.length).toBeGreaterThan(0);
    expect(Object.keys(FAMILYQUEST_BUILD)).toEqual([
      'version',
      'sha',
      'builtAt',
      'environment',
      'firebaseProjectId',
    ]);
  });

  it('maps Vite modes to environment labels', async () => {
    const { resolveEnvironment } = await import('./buildInfo');

    expect(resolveEnvironment('development', false)).toBe('DEVELOPMENT');
    expect(resolveEnvironment('preview', false)).toBe('PREVIEW');
    expect(resolveEnvironment('production', true)).toBe('PRODUCTION');
    expect(resolveEnvironment(undefined, true)).toBe('PRODUCTION');
    expect(resolveEnvironment(undefined, false)).toBe('DEVELOPMENT');
  });
});

describe('missing build metadata fallbacks', () => {
  it('falls back to "unknown" when git metadata is unavailable', async () => {
    const { safeBuildValue, BUILD_INFO_FALLBACK } = await import('./buildInfo');

    expect(BUILD_INFO_FALLBACK).toBe('unknown');
    expect(safeBuildValue(undefined)).toBe('unknown');
    expect(safeBuildValue('')).toBe('unknown');
    expect(safeBuildValue('   ')).toBe('unknown');
    expect(safeBuildValue('402cb1f')).toBe('402cb1f');
  });
});
