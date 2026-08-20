import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('one-release legacy service-worker migration', () => {
  it('builds an immediate-activation worker with the explicit migration script', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    const workerMigration = readFileSync('public/legacy-sw-migration.js', 'utf8');

    expect(config).toContain("const legacySwMigrationId = 'legacy-82422c8-2026-08'");
    expect(config).toContain('skipWaiting: legacySwMigrationEnabled');
    expect(config).toContain('clientsClaim: legacySwMigrationEnabled');
    expect(config).toContain('legacy-sw-migration.js?migration=${legacySwMigrationId}');
    expect(workerMigration).toContain("const MIGRATION_ID = 'legacy-82422c8-2026-08'");
    expect(workerMigration).toContain("self.addEventListener('activate'");
    expect(workerMigration).toContain('LEGACY_SW_MIGRATION_NAVIGATING');
    expect(workerMigration).toContain('client.navigate(client.url)');
  });
});
