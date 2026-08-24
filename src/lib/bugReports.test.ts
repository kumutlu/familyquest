import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTechnicalContext, BUG_REPORT_CATEGORIES } from './bugReports';

describe('bugReports — technical context collection', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('navigator', {
      userAgent: 'Queki-Test-Agent',
      onLine: true,
      serviceWorker: { controller: {} },
    });
  });

  it('collects strictly allow-listed technical context without sensitive store dumps', () => {
    const ctx = collectTechnicalContext('dark', 'en', '/rewards');
    expect(ctx.route).toBe('/rewards');
    expect(ctx.theme).toBe('dark');
    expect(ctx.locale).toBe('en');
    expect(ctx.viewport).toEqual({ width: 390, height: 844 });
    expect(ctx.online).toBe(true);
    expect(ctx.userAgent).toBe('Queki-Test-Agent');
    expect(ctx.swControlled).toBe(true);
    expect(ctx.releaseSha).toBeDefined();
    expect(ctx.releaseVersion).toBeDefined();

    // Verify no unexpected/sensitive properties leaked
    const keys = Object.keys(ctx);
    const ALLOWED_KEYS = [
      'releaseSha',
      'releaseVersion',
      'route',
      'theme',
      'locale',
      'viewport',
      'standalone',
      'online',
      'userAgent',
      'swControlled',
    ];
    for (const key of keys) {
      expect(ALLOWED_KEYS).toContain(key);
    }
  });

  it('provides the 7 friendly product categories', () => {
    expect(BUG_REPORT_CATEGORIES).toEqual([
      'broken',
      'visual',
      'points_rewards',
      'tasks',
      'wallet',
      'family',
      'other',
    ]);
  });
});
