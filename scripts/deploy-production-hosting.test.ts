import { describe, expect, it } from 'vitest';
import { productionHostingDeployCommand, validateProductionDeploy } from './deploy-production-hosting.mjs';

const approved = {
  branch: 'todo-theme',
  clean: true,
  head: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  remoteHead: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
  expectedSha: '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf',
};

describe('production Hosting deploy provenance guard', () => {
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
