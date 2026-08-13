#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { validateProductionDeploy } from './deploy-production-hosting.mjs'

const APPROVED_BRANCH = 'todo-theme'
const PRODUCTION_PROJECT = 'familyquest-beta-402cb'
const FIREBASE_CLI = 'node_modules/firebase-tools/lib/bin/firebase.js'

export function productionFunctionsBuildCommand(npmExecutable = 'npm') {
  return { command: npmExecutable, args: ['--prefix', 'functions', 'run', 'build'] }
}

export function productionFunctionsDeployCommand(nodeExecutable = process.execPath) {
  return {
    command: nodeExecutable,
    args: [FIREBASE_CLI, 'deploy', '--only', 'functions', '--project', PRODUCTION_PROJECT],
  }
}

export function validateFunctionsProductionDeploy(context) {
  const result = validateProductionDeploy(context)
  if (context.headReachable !== true) {
    throw new Error(`Refusing production deploy: HEAD is not reachable from origin/${APPROVED_BRANCH}`)
  }
  return result
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim()
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function expectedShaFromArgs(argv) {
  const index = argv.indexOf('--expected-sha')
  return index >= 0 ? argv[index + 1] : undefined
}

function isHeadReachable() {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', `origin/${APPROVED_BRANCH}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function stampAndVerifyFunctionsBuild(sha) {
  const entryPoint = 'functions/lib/functions/src/index.js'
  if (!existsSync(entryPoint)) throw new Error('Refusing production deploy: Functions build entry point is missing')
  const provenancePath = 'functions/lib/deployment-provenance.json'
  writeFileSync(provenancePath, `${JSON.stringify({ gitSha: sha })}\n`, 'utf8')
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
  if (provenance.gitSha !== sha) throw new Error('Refusing production deploy: Functions build SHA verification failed')
}

export function runProductionFunctionsDeploy(argv = process.argv.slice(2)) {
  run('git', ['fetch', 'origin', APPROVED_BRANCH])
  const head = git(['rev-parse', 'HEAD'])
  const result = validateFunctionsProductionDeploy({
    branch: git(['branch', '--show-current']),
    clean: git(['status', '--porcelain']) === '',
    head,
    remoteHead: git(['rev-parse', `origin/${APPROVED_BRANCH}`]),
    expectedSha: expectedShaFromArgs(argv),
    headReachable: isHeadReachable(),
  })

  console.log(`Building approved Functions SHA ${result.sha}`)
  const build = productionFunctionsBuildCommand()
  run(build.command, build.args)
  stampAndVerifyFunctionsBuild(result.sha)
  console.log(`Deploying Functions only for ${result.sha}`)
  const deploy = productionFunctionsDeployCommand()
  run(deploy.command, deploy.args)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runProductionFunctionsDeploy()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
