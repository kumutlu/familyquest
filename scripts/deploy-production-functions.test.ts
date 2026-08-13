import { describe, expect, it } from 'vitest'
import {
  productionFunctionsBuildCommand,
  productionFunctionsDeployCommand,
  validateFunctionsProductionDeploy,
} from './deploy-production-functions.mjs'

const sha = '8eddf9eea52e7b352cb9aee086e88d31d9f0c2bf'
const approved = { branch: 'todo-theme', clean: true, head: sha, remoteHead: sha, expectedSha: sha, headReachable: true }

describe('production Functions deploy provenance guard', () => {
  it('accepts only a clean reviewed commit reachable from the approved remote branch', () => {
    expect(validateFunctionsProductionDeploy(approved)).toEqual({ sha, shortSha: '8eddf9e' })
  })

  it.each([
    [{ ...approved, clean: false }, 'worktree is not clean'],
    [{ ...approved, branch: 'feature/local' }, 'current branch must be todo-theme'],
    [{ ...approved, remoteHead: '1'.repeat(40) }, 'HEAD does not match origin/todo-theme'],
    [{ ...approved, headReachable: false }, 'HEAD is not reachable'],
    [{ ...approved, expectedSha: '2'.repeat(40) }, 'expected SHA does not match HEAD'],
  ])('fails closed for unsafe provenance', (context, message) => {
    expect(() => validateFunctionsProductionDeploy(context)).toThrow(message)
  })

  it('builds Functions and deploys Functions only through pinned entry points', () => {
    expect(productionFunctionsBuildCommand('/node')).toEqual({
      command: '/node', args: ['node_modules/npm/bin/npm-cli.js', '--prefix', 'functions', 'run', 'build'],
    })
    expect(productionFunctionsDeployCommand('/node')).toEqual({
      command: '/node',
      args: ['node_modules/firebase-tools/lib/bin/firebase.js', 'deploy', '--only', 'functions', '--project', 'familyquest-beta-402cb'],
    })
  })
})
