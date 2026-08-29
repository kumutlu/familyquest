import { describe, expect, it } from 'vitest';
import {
  classifyDeploymentRelationship,
  extractEmbeddedBuildSha,
  extractMainBundlePath,
  productionBuildCommands,
  productionHostingDeployCommand,
  verifyPostDeployBuildSha,
  validateProductionDeploy,
} from './deploy-production-hosting.mjs';

const liveSha = '505761582a3002f5af1322208e16790484163d8a';
const olderSha = '82422c89b5d7338138b85f62c961bb223a770b72';
const newerSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const divergedSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const approved = {
  branch: 'todo-theme',
  clean: true,
  head: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  remoteHead: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  expectedSha: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  liveSha: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  isAncestor: () => true,
};

describe('production Hosting deploy provenance guard', () => {
  it('blocks the incident direction when candidate 82422c8 is older than live 5057615', () => {
    expect(() => validateProductionDeploy({
      ...approved,
      head: olderSha,
      remoteHead: olderSha,
      expectedSha: olderSha,
      liveSha,
      isAncestor: (ancestor: string, descendant: string) => (
        ancestor === olderSha && descendant === liveSha
      ),
    })).toThrow('DEPLOY BLOCKED: candidate SHA is older than current production');
  });

  it('allows a newer descendant candidate', () => {
    expect(classifyDeploymentRelationship({
      liveSha,
      candidateSha: newerSha,
      isAncestor: (ancestor: string, descendant: string) => (
        ancestor === liveSha && descendant === newerSha
      ),
    })).toBe('FORWARD');
  });

  it('allows an exact same-SHA redeploy', () => {
    expect(classifyDeploymentRelationship({
      liveSha,
      candidateSha: liveSha,
      isAncestor: () => false,
    })).toBe('SAME');
  });

  it('classifies an older ancestor candidate as blocked', () => {
    expect(classifyDeploymentRelationship({
      liveSha,
      candidateSha: olderSha,
      isAncestor: (ancestor: string, descendant: string) => (
        ancestor === olderSha && descendant === liveSha
      ),
    })).toBe('BACKWARD_BLOCKED');
  });

  it('classifies unrelated histories as blocked', () => {
    expect(classifyDeploymentRelationship({
      liveSha,
      candidateSha: divergedSha,
      isAncestor: () => false,
    })).toBe('DIVERGED_BLOCKED');
  });

  it('fails closed when the live SHA is unknown', () => {
    expect(classifyDeploymentRelationship({
      liveSha: undefined,
      candidateSha: newerSha,
      isAncestor: () => true,
    })).toBe('UNKNOWN_BLOCKED');
    expect(() => validateProductionDeploy({
      ...approved,
      head: newerSha,
      remoteHead: newerSha,
      expectedSha: newerSha,
      liveSha: undefined,
    })).toThrow('DEPLOY BLOCKED: current production SHA is unknown');
  });

  it('extracts the main bundle and its embedded build SHA', () => {
    expect(extractMainBundlePath('<script type="module" src="/assets/index-AbC123.js"></script>'))
      .toBe('/assets/index-AbC123.js');
    expect(extractEmbeddedBuildSha('Object.freeze({version:x(`1.0.0`),sha:x(`5057615`),builtAt:x(`now`)})'))
      .toBe('5057615');
  });

  it('fails closed for missing or ambiguous embedded build metadata', () => {
    expect(() => extractMainBundlePath('<html></html>')).toThrow('main JavaScript bundle');
    expect(() => extractEmbeddedBuildSha('sha:x(`5057615`), sha:x(`82422c8`)'))
      .toThrow('embedded production build SHA');
  });

  it('rejects a post-deploy live SHA mismatch with expected and actual values', () => {
    expect(() => verifyPostDeployBuildSha('5057615', '82422c8'))
      .toThrow('Post-deploy SHA mismatch: expected 5057615, actual 82422c8');
    expect(verifyPostDeployBuildSha('5057615', '5057615')).toBeUndefined();
  });

  it('invokes the installed Firebase CLI directly with Hosting-only scope', () => {
    expect(productionHostingDeployCommand('/usr/local/bin/node')).toEqual({
      command: '/usr/local/bin/node',
      args: [
        'node_modules/firebase-tools/lib/bin/firebase.js',
        'deploy',
        '--only',
        'hosting',
        '--project',
        'familyquest-beta-402cb',
      ],
    });
  });

  it('runs the production build through repository-pinned Node entry points', () => {
    expect(productionBuildCommands('/usr/local/bin/node')).toEqual([
      {
        command: '/usr/local/bin/node',
        args: ['node_modules/typescript/bin/tsc', '-b'],
      },
      {
        command: '/usr/local/bin/node',
        args: ['node_modules/vite/bin/vite.js', 'build'],
      },
    ]);
  });

  it('accepts only the clean approved branch at the acknowledged remote SHA', () => {
    expect(validateProductionDeploy(approved)).toEqual({
      sha: approved.head,
      shortSha: '8eddf9e',
    });
  });

  it.each([
    [{ ...approved, clean: false }, 'worktree is not clean'],
    [{ ...approved, branch: 'feature/test' }, 'current branch must be todo-theme'],
    [{ ...approved, remoteHead: '1111111111111111111111111111111111111111' }, 'HEAD does not match origin/todo-theme'],
    [{ ...approved, expectedSha: '' }, 'exact expected SHA is required'],
    [{ ...approved, expectedSha: '8eddf9e' }, 'expected SHA must be the full 40-character commit'],
    [{ ...approved, expectedSha: '2222222222222222222222222222222222222222' }, 'expected SHA does not match HEAD'],
  ])('rejects unsafe provenance: %s', (context, message) => {
    expect(() => validateProductionDeploy(context)).toThrow(message);
  });
});
