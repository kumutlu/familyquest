#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const APPROVED_BRANCH = 'todo-theme';
const PRODUCTION_PROJECT = 'familyquest-beta-402cb';
const FIREBASE_CLI = 'node_modules/firebase-tools/lib/bin/firebase.js';
const LIVE_PRODUCTION_ORIGIN = `https://${PRODUCTION_PROJECT}.web.app`;

export function productionBuildCommands(nodeExecutable = process.execPath) {
  return [
    { command: nodeExecutable, args: ['node_modules/typescript/bin/tsc', '-b'] },
    { command: nodeExecutable, args: ['node_modules/vite/bin/vite.js', 'build'] },
  ];
}

export function productionHostingDeployCommand(nodeExecutable = process.execPath) {
  return {
    command: nodeExecutable,
    args: [FIREBASE_CLI, 'deploy', '--only', 'hosting', '--project', PRODUCTION_PROJECT],
  };
}

export function classifyDeploymentRelationship({ liveSha, candidateSha, isAncestor }) {
  if (!liveSha) return 'UNKNOWN_BLOCKED';
  if (liveSha === candidateSha) return 'SAME';
  try {
    if (isAncestor(liveSha, candidateSha)) return 'FORWARD';
    if (isAncestor(candidateSha, liveSha)) return 'BACKWARD_BLOCKED';
    return 'DIVERGED_BLOCKED';
  } catch {
    return 'UNKNOWN_BLOCKED';
  }
}

export function validateLocalProvenance(context) {
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

export function validateProductionDeploy(context) {
  const result = validateLocalProvenance(context);
  const relationship = context.relationship ?? classifyDeploymentRelationship({
    liveSha: context.liveSha,
    candidateSha: context.head,
    isAncestor: context.isAncestor,
  });
  if (relationship === 'BACKWARD_BLOCKED') {
    throw new Error('DEPLOY BLOCKED: candidate SHA is older than current production');
  }
  if (relationship === 'DIVERGED_BLOCKED') {
    throw new Error('DEPLOY BLOCKED: candidate SHA has diverged from current production');
  }
  if (relationship === 'UNKNOWN_BLOCKED') {
    throw new Error('DEPLOY BLOCKED: current production SHA is unknown');
  }
  return result;
}

export function extractMainBundlePath(indexHtml) {
  const matches = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']*\/assets\/index-[^"']+\.js)["'][^>]*>/gi)]
    .map(match => match[1]);
  const uniqueMatches = [...new Set(matches)];
  if (uniqueMatches.length !== 1) {
    throw new Error('Could not reliably identify the live main JavaScript bundle');
  }
  return uniqueMatches[0];
}

export function extractEmbeddedBuildSha(bundleSource) {
  const matches = [...bundleSource.matchAll(/\bsha\s*:\s*[$\w]+\(\s*[`'"]([0-9a-f]{7})[`'"]\s*\)\s*,\s*builtAt\s*:/g)]
    .map(match => match[1]);
  const uniqueMatches = [...new Set(matches)];
  if (uniqueMatches.length !== 1) {
    throw new Error('Could not reliably determine the embedded production build SHA');
  }
  return uniqueMatches[0];
}

async function fetchUncachedText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.text();
}

export async function readLiveProductionBuild({
  origin = LIVE_PRODUCTION_ORIGIN,
  fetchImpl = fetch,
  cacheBuster = Date.now(),
} = {}) {
  const indexUrl = new URL(`/?deploy-guard=${cacheBuster}`, origin);
  const indexHtml = await fetchUncachedText(indexUrl, fetchImpl);
  const bundlePath = extractMainBundlePath(indexHtml);
  const bundleUrl = new URL(bundlePath, origin);
  bundleUrl.searchParams.set('deploy-guard', String(cacheBuster));
  const bundleSource = await fetchUncachedText(bundleUrl, fetchImpl);
  return { bundlePath, shortSha: extractEmbeddedBuildSha(bundleSource) };
}

export function verifyPostDeployBuildSha(expectedShortSha, actualShortSha) {
  if (expectedShortSha !== actualShortSha) {
    throw new Error(`Post-deploy SHA mismatch: expected ${expectedShortSha}, actual ${actualShortSha}`);
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function isGitAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

function resolveFullCommit(shortSha) {
  const fullSha = git(['rev-parse', '--verify', `${shortSha}^{commit}`]);
  if (!fullSha.startsWith(shortSha)) {
    throw new Error(`Resolved production commit ${fullSha} does not match embedded SHA ${shortSha}`);
  }
  return fullSha;
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

function logDeploymentRelationship({ currentProductionSha, candidateSha, remoteHead, relationship }) {
  console.log(`CURRENT_PRODUCTION_SHA=${currentProductionSha}`);
  console.log(`CANDIDATE_SHA=${candidateSha}`);
  console.log(`ORIGIN_TODO_THEME_SHA=${remoteHead}`);
  console.log(`RELATIONSHIP=${relationship}`);
}

export async function runProductionHostingDeploy(argv = process.argv.slice(2)) {
  const expectedSha = expectedShaFromArgs(argv);
  run('git', ['fetch', 'origin', APPROVED_BRANCH]);
  const localContext = {
    branch: git(['branch', '--show-current']),
    clean: git(['status', '--porcelain']) === '',
    head: git(['rev-parse', 'HEAD']),
    remoteHead: git(['rev-parse', `origin/${APPROVED_BRANCH}`]),
    expectedSha,
  };
  validateLocalProvenance(localContext);

  let liveBuild;
  let liveSha;
  try {
    liveBuild = await readLiveProductionBuild();
    liveSha = resolveFullCommit(liveBuild.shortSha);
  } catch (error) {
    logDeploymentRelationship({
      currentProductionSha: 'UNKNOWN',
      candidateSha: localContext.head,
      remoteHead: localContext.remoteHead,
      relationship: 'UNKNOWN_BLOCKED',
    });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`DEPLOY BLOCKED: current production SHA is unknown (${detail})`);
  }

  const relationship = classifyDeploymentRelationship({
    liveSha,
    candidateSha: localContext.head,
    isAncestor: isGitAncestor,
  });
  logDeploymentRelationship({
    currentProductionSha: liveSha,
    candidateSha: localContext.head,
    remoteHead: localContext.remoteHead,
    relationship,
  });
  const result = validateProductionDeploy({
    ...localContext,
    liveSha,
    relationship,
    isAncestor: isGitAncestor,
  });

  console.log(`Building approved production SHA ${result.sha}`);
  for (const build of productionBuildCommands()) run(build.command, build.args);
  verifyEmbeddedBuildSha(result.shortSha);
  console.log(`Deploying Hosting only for ${result.sha}`);
  const deploy = productionHostingDeployCommand();
  run(deploy.command, deploy.args);
  const postDeployBuild = await readLiveProductionBuild();
  verifyPostDeployBuildSha(result.shortSha, postDeployBuild.shortSha);
  console.log(`Post-deploy Hosting SHA verified: ${postDeployBuild.shortSha}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runProductionHostingDeploy().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
