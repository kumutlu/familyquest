#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLiveProductionBuild, resolveEmbeddedProductionSha } from './deploy-production-hosting.mjs';

const ACKNOWLEDGED_LIVE_SHA = 'bd175a50cb76569ca65483d20af04e1b6e6bfab9';
const APPROVED_ROLLBACK_SHA = '7316472f933cc6e8e1b963927f9d0c39b33a64f1';
const PROJECT = 'familyquest-beta-402cb';

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
}

async function main() {
  if (git(['status', '--porcelain=v1']) !== '') throw new Error('RECOVERY BLOCKED: worktree is not clean');
  run('git', ['fetch', 'origin', 'todo-theme']);
  if (git(['rev-parse', 'origin/todo-theme']) !== ACKNOWLEDGED_LIVE_SHA) {
    throw new Error('RECOVERY BLOCKED: origin/todo-theme is not the acknowledged live SHA');
  }
  try {
    run('git', ['merge-base', '--is-ancestor', ACKNOWLEDGED_LIVE_SHA, 'HEAD']);
  } catch {
    throw new Error('RECOVERY BLOCKED: recovery branch is not based on the acknowledged live SHA');
  }
  if (git(['rev-parse', `${APPROVED_ROLLBACK_SHA}^{commit}`]) !== APPROVED_ROLLBACK_SHA) {
    throw new Error('RECOVERY BLOCKED: approved rollback SHA does not resolve exactly');
  }

  const before = resolveEmbeddedProductionSha((await readLiveProductionBuild()).embeddedSha);
  if (before !== ACKNOWLEDGED_LIVE_SHA) {
    throw new Error(`RECOVERY BLOCKED: expected live ${ACKNOWLEDGED_LIVE_SHA}, actual ${before}`);
  }

  const recoveryRoot = mkdtempSync(join(tmpdir(), 'familyquest-hosting-rollback-'));
  const checkout = join(recoveryRoot, 'repo');
  try {
    run('git', ['worktree', 'add', '--detach', checkout, APPROVED_ROLLBACK_SHA]);
    run('npm', ['ci', '--legacy-peer-deps'], { cwd: checkout });
    run('npm', ['run', 'build'], { cwd: checkout });

    const bundles = readdirSync(join(checkout, 'dist/assets')).filter(name => /^index-.*\.js$/.test(name));
    const marker = `[FamilyQuest Build SHA:${APPROVED_ROLLBACK_SHA}]`;
    if (!bundles.some(name => readFileSync(join(checkout, 'dist/assets', name), 'utf8').includes(marker))) {
      throw new Error(`RECOVERY BLOCKED: rollback build does not embed ${APPROVED_ROLLBACK_SHA}`);
    }

    run(process.execPath, [
      'node_modules/firebase-tools/lib/bin/firebase.js',
      'deploy', '--only', 'hosting', '--project', PROJECT,
    ], { cwd: checkout });
  } finally {
    try { run('git', ['worktree', 'remove', '--force', checkout]); } catch {}
    rmSync(recoveryRoot, { recursive: true, force: true });
  }

  const after = resolveEmbeddedProductionSha((await readLiveProductionBuild()).embeddedSha);
  if (after !== APPROVED_ROLLBACK_SHA) {
    throw new Error(`RECOVERY FAILED: expected live ${APPROVED_ROLLBACK_SHA}, actual ${after}`);
  }
  console.log(`RECOVERY_VERIFIED_SHA=${after}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
