import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const reports: string[] = [];

afterEach(() => {
  for (const report of reports.splice(0)) rmSync(report, { force: true, recursive: true });
});

describe('web test worktree isolation', () => {
  it('runs the requested startup recovery suite only once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'familyquest-worktree-isolation-'));
    reports.push(directory);
    const outputFile = join(directory, 'startup-recovery.json');

    try {
      execFileSync(
        process.execPath,
        ['node_modules/vitest/vitest.mjs', 'run', 'src/components/layout/startupRecovery.test.tsx', '--reporter=json', `--outputFile=${outputFile}`],
        { cwd: process.cwd(), env: process.env, stdio: 'pipe' },
      );
    } catch {
      // The report below contains the runner result we assert on.
    }

    const report = JSON.parse(readFileSync(outputFile, 'utf8'));
    expect(report.numFailedTests).toBe(0);
    expect(report.testResults).toHaveLength(1);
    expect(report.testResults[0].name).toContain('/src/components/layout/startupRecovery.test.tsx');
  });
});
