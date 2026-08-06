'use strict'
// Focused CLI tests for the wallet-snapshot and backup-gamification-collections
// scripts. These tests ONLY exercise argument/help handling — they never run a
// real export, never read Firestore, never write files, and never touch
// production credentials. Firebase initialization is actively forbidden during
// --help via a require guard preload.
//
// Run with: node scripts/cli-help.test.cjs
const { spawnSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const WALLET = path.join(__dirname, 'wallet-snapshot.cjs')
const BACKUP = path.join(__dirname, 'backup-gamification-collections.cjs')
const GUARD = path.join(__dirname, '_cli_firebase_guard.cjs')

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log('PASS: ' + name)
  } else {
    failures++
    console.error('FAIL: ' + name + (detail ? ' — ' + detail : ''))
  }
}

function run(script, args, opts) {
  opts = opts || {}
  const nodeArgs = []
  if (opts.guard) nodeArgs.push('--require', GUARD)
  nodeArgs.push(script)
  if (args && args.length) nodeArgs.push(...args)
  return spawnSync('node', nodeArgs, { encoding: 'utf8', cwd: ROOT })
}

const RAW_TYPEERROR = /Cannot read properties of undefined/

// 1. --help exits 0 for both scripts.
const wHelp = run(WALLET, ['--help'])
check('wallet --help exits 0', wHelp.status === 0, 'status=' + wHelp.status + ' stderr=' + wHelp.stderr)
const bHelp = run(BACKUP, ['--help'])
check('backup --help exits 0', bHelp.status === 0, 'status=' + bHelp.status + ' stderr=' + bHelp.stderr)

// 2. help contains usage and supported options.
const wOut = wHelp.stdout || ''
check('wallet help mentions Usage', /usage/i.test(wOut))
check('wallet help lists --dry-run', wOut.includes('--dry-run'))
check('wallet help lists --output', wOut.includes('--output'))
check('wallet help lists --verify', wOut.includes('--verify'))
check('wallet help lists --check', wOut.includes('--check'))
const bOut = bHelp.stdout || ''
check('backup help mentions Usage', /usage/i.test(bOut))
check('backup help lists --dry-run', bOut.includes('--dry-run'))

// 3. Firebase is never initialized during --help (require guard).
const wGuard = run(WALLET, ['--help'], { guard: true })
check(
  'wallet --help never requires firebase-admin',
  wGuard.status === 0 && !/FIREBASE_GUARD/.test(wGuard.stderr || ''),
  'status=' + wGuard.status + ' stderr=' + wGuard.stderr
)
const bGuard = run(BACKUP, ['--help'], { guard: true })
check(
  'backup --help never requires firebase-admin',
  bGuard.status === 0 && !/FIREBASE_GUARD/.test(bGuard.stderr || ''),
  'status=' + bGuard.status + ' stderr=' + bGuard.stderr
)

// 4. missing option value gives a controlled error (no raw TypeError).
const wMissOut = run(WALLET, ['--output'])
check('wallet --output (no value) exits non-zero', wMissOut.status !== 0, 'status=' + wMissOut.status)
check('wallet --output missing: no raw TypeError', !RAW_TYPEERROR.test(wMissOut.stderr || ''))
check(
  'wallet --output missing: clear error',
  /missing required value for --output/i.test((wMissOut.stderr || '') + (wMissOut.stdout || ''))
)
const wMissVerify = run(WALLET, ['--verify'])
check('wallet --verify (no value) exits non-zero', wMissVerify.status !== 0, 'status=' + wMissVerify.status)
check('wallet --verify missing: no raw TypeError', !RAW_TYPEERROR.test(wMissVerify.stderr || ''))

// 5. unknown flag gives a controlled error (no raw TypeError).
const wUnknown = run(WALLET, ['--bogus'])
check('wallet unknown flag exits non-zero', wUnknown.status !== 0, 'status=' + wUnknown.status)
check('wallet unknown flag: no raw TypeError', !RAW_TYPEERROR.test(wUnknown.stderr || ''))
check(
  'wallet unknown flag: clear error',
  /unknown argument/i.test((wUnknown.stderr || '') + (wUnknown.stdout || ''))
)
const bUnknown = run(BACKUP, ['--bogus'])
check('backup unknown flag exits non-zero', bUnknown.status !== 0, 'status=' + bUnknown.status)
check('backup unknown flag: no raw TypeError', !RAW_TYPEERROR.test(bUnknown.stderr || ''))

// 6. no raw .length TypeError remains in any CLI-handled path.
check('wallet --dry-run: no raw TypeError', !RAW_TYPEERROR.test(run(WALLET, ['--dry-run']).stderr || ''))
check('backup --dry-run: no raw TypeError', !RAW_TYPEERROR.test(run(BACKUP, ['--dry-run']).stderr || ''))

if (failures > 0) {
  console.error('\n' + failures + ' CLI test(s) FAILED')
  process.exit(1)
}
console.log('\nAll CLI tests passed')
