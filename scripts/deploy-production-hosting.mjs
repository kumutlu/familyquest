#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const APPROVED_BRANCH = 'todo-theme';
const PRODUCTION_PROJECT = 'familyquest-beta-402cb';
const FIREBASE_CLI = 'node_modules/firebase-tools/lib/bin/firebase.js';

export function productionHostingDeployCommand(nodeExecutable = process.execPath) {
  return {
    command: nodeExecutable,
    args: [FIREBASE_CLI, 'deploy', '--only', 'hosting', '--project', PRODUCTION_PROJECT],
  };
}

export function validateProductionDeploy(context) {
  if (!context.clean) throw new Error('Refusing production deploy: worktree is not clean');
  if (context.branch !== APPROVED_BRANCH) {
    throw new Error(`Refusing production deploy: current branch must be ${APPROVED_BRANCH}`);
  }
  if (!context.expectedSha) throw new Error('Refusing production deploy: exact expected SHA is required');
  if (!/^[0-9a-f]{40}$/.test(context.expectedSha)) {
    throw new Error('Refusing production deploy: expected SHA must be the full 40-character commit');
  }
  if (context.head !== context.remoteHead) {
    throw new Error(`Refusing production deploy: HEAD does not match origin/${APPROVED_BRANCH}`);
  }
  if (context.expectedSha !== context.head) {
    throw new Error('Refusing production deploy: expected SHA does not match HEAD');
  }
  return { sha: context.head, shortSha: context.head.slice(0, 7) };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function expectedShaFromArgs(argv) {
  const index = argv.indexOf('--expected-sha');
  return index >= 0 ? argv[index + 1] : undefined;
}

function verifyEmbeddedBuildSha(shortSha) {
  const bundles = readdirSync('dist/assets').filter(name => /^index-.*\.js$/.test(name));
  const found = bundles.some(name => readFileSync(`dist/assets/${name}`, 'utf8').includes(shortSha));
  if (!found) throw new Error(`Refusing production deploy: production build does not embed ${shortSha}`);
}

export function runProductionHostingDeploy(argv = process.argv.slice(2)) {
  const expectedSha = expectedShaFromArgs(argv);
  run('git', ['fetch', 'origin', APPROVED_BRANCH]);
  const result = validateProductionDeploy({
    branch: git(['branch', '--show-current']),
    clean: git(['status', '--porcelain']) === '',
    head: git(['rev-parse', 'HEAD']),
    remoteHead: git(['rev-parse', `origin/${APPROVED_BRANCH}`]),
    expectedSha,
  });

  console.log(`Building approved production SHA ${result.sha}`);
  run('npm', ['run', 'build']);
  verifyEmbeddedBuildSha(result.shortSha);
  console.log(`Deploying Hosting only for ${result.sha}`);
  const deploy = productionHostingDeployCommand();
  run(deploy.command, deploy.args);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runProductionHostingDeploy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
