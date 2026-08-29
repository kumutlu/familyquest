#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const APPROVED_BRANCH = 'todo-theme';
const PRODUCTION_PROJECT = 'familyquest-beta-402cb';
const FIREBASE_CLI = 'node_modules/firebase-tools/lib/bin/firebase.js';
const LIVE_PRODUCTION_ORIGIN = `https://${PRODUCTION_PROJECT}.web.app`;
const LEGACY_PRODUCTION_SHA_MAP = new Map([
  ['5057615', '505761582a3002f5af1322208e16790484163d8a'],
]);

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
  if (relationship !== 'SAME' && relationship !== 'FORWARD') {
    throw new Error(`DEPLOY BLOCKED: unrecognized production relationship ${relationship}`);
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
  const fullMatches = [...bundleSource.matchAll(/\[FamilyQuest Build SHA:([0-9a-f]{40})\]/g)]
    .map(match => match[1]);
  const uniqueFullMatches = [...new Set(fullMatches)];
  if (uniqueFullMatches.length === 1) return uniqueFullMatches[0];
  if (uniqueFullMatches.length > 1) {
    throw new Error('Could not reliably determine the embedded production build SHA');
  }

  // Bootstrap compatibility for the already-approved 5057615 production
  // release, which predates the stable full-SHA marker. Resolution is pinned
  // below; arbitrary seven-character Git abbreviations are never trusted.
  const legacyMatches = [...bundleSource.matchAll(/\bsha\s*:\s*[$\w]+\(\s*[`'"]([0-9a-f]{7})[`'"]\s*\)\s*,\s*builtAt\s*:/g)]
    .map(match => match[1]);
  const uniqueLegacyMatches = [...new Set(legacyMatches)];
  if (uniqueLegacyMatches.length === 1) return uniqueLegacyMatches[0];
  throw new Error('Could not reliably determine the embedded production build SHA');
}

export function resolveEmbeddedProductionSha(embeddedSha) {
  if (/^[0-9a-f]{40}$/.test(embeddedSha)) return embeddedSha;
  const approvedLegacySha = LEGACY_PRODUCTION_SHA_MAP.get(embeddedSha);
  if (approvedLegacySha) return approvedLegacySha;
  throw new Error(`legacy embedded production SHA is not approved: ${embeddedSha}`);
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
  return { bundlePath, embeddedSha: extractEmbeddedBuildSha(bundleSource) };
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

export async function runProductionHostingDeploy(argv = process.argv.slice(2), dependencies = {}) {
  const runCommand = dependencies.run ?? run;
  const gitCommand = dependencies.git ?? git;
  const readLiveBuild = dependencies.readLiveProductionBuild ?? readLiveProductionBuild;
  const resolveEmbeddedSha = dependencies.resolveEmbeddedProductionSha ?? resolveEmbeddedProductionSha;
  const ancestorCheck = dependencies.isAncestor ?? isGitAncestor;
  const expectedSha = expectedShaFromArgs(argv);
  runCommand('git', ['fetch', 'origin', APPROVED_BRANCH]);
  const localContext = {
    branch: gitCommand(['branch', '--show-current']),
    clean: gitCommand(['status', '--porcelain']) === '',
    head: gitCommand(['rev-parse', 'HEAD']),
    remoteHead: gitCommand(['rev-parse', `origin/${APPROVED_BRANCH}`]),
    expectedSha,
  };
  validateLocalProvenance(localContext);

  let liveBuild;
  let liveSha;
  try {
    liveBuild = await readLiveBuild();
    liveSha = resolveEmbeddedSha(liveBuild.embeddedSha);
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
    isAncestor: ancestorCheck,
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
    isAncestor: ancestorCheck,
  });

  console.log(`Building approved production SHA ${result.sha}`);
  for (const build of productionBuildCommands()) runCommand(build.command, build.args);
  verifyEmbeddedBuildSha(result.shortSha);
  console.log(`Deploying Hosting only for ${result.sha}`);
  const deploy = productionHostingDeployCommand();
  runCommand(deploy.command, deploy.args);
  const postDeployBuild = await readLiveBuild();
  const postDeploySha = resolveEmbeddedSha(postDeployBuild.embeddedSha);
  verifyPostDeployBuildSha(result.sha, postDeploySha);
  console.log(`Post-deploy Hosting SHA verified: ${postDeploySha}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runProductionHostingDeploy().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
