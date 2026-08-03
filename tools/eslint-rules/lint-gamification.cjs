#!/usr/bin/env node
/**
 * CI gate for the `no-gamification-firestore` architecture rule.
 *
 * Runs the rule across the frontend and compares the result with the
 * shrink-only allowlist in `gamification-allowlist.json`.
 *
 * Fails when:
 *   - a violation exists that is not allowlisted (a NEW violation);
 *   - the allowlist has more entries than the recorded Phase 0 baseline;
 *   - an allowlist entry is stale (the violation it covers is gone);
 *   - an allowlist entry is malformed (no inventory reference, no removal
 *     phase, a wildcard, a duplicate, or a missing file).
 *
 * Usage:
 *   node tools/eslint-rules/lint-gamification.cjs
 *   node tools/eslint-rules/lint-gamification.cjs --json
 *   node tools/eslint-rules/lint-gamification.cjs --write-baseline   # Phase 0 only
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { analyze, isFrontendFile, normalise, VIOLATIONS } = require('./no-gamification-firestore.cjs')

const ROOT = path.resolve(__dirname, '../..')
const ALLOWLIST_PATH = path.join(__dirname, 'gamification-allowlist.json')
const INVENTORY = 'docs/gamification-v3/05-current-state-inventory.md'
const VALID_PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6']

function frontendFiles() {
  // `--others --exclude-standard` so a brand-new, not-yet-staged file is also
  // checked: a new violation must fail immediately, not only after `git add`.
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map(normalise)
    .filter(isFrontendFile)
    .sort()
}

function scanAll() {
  const found = []
  for (const file of frontendFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    found.push(...analyze(file, source))
  }
  return found
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { baselineEntryCount: 0, inventory: INVENTORY, entries: [] }
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
}

/** Phase mapping used only when seeding the Phase 0 baseline. */
function removalPhaseFor(file) {
  if (/^src\/lib\/(api|reversalApi|reversalHistory|behaviour|googleRedirectAuth)\./.test(file)) return 'Phase 3'
  if (/^src\/components\/reversals\//.test(file)) return 'Phase 3'
  return 'Phase 4'
}

function inventoryAnchorFor(file) {
  if (/^src\/pages\/Family\.tsx$/.test(file)) return `${INVENTORY}#7-summary-table--independent-leaderboard-calculations`
  if (/^src\/lib\/gamificationAdapters\.ts$/.test(file)) return `${INVENTORY}#6-summary-table--legacy-fallbacks`
  if (/^src\/lib\/(api|reversalApi|reversalHistory|behaviour|googleRedirectAuth)\./.test(file)) {
    return `${INVENTORY}#2-summary-table--all-client-side-gamification-writes`
  }
  if (/^src\/(pages|components)\//.test(file)) return `${INVENTORY}#4-summary-table--all-direct-firestore-gamification-reads-from-the-ui-layer`
  return `${INVENTORY}#3-summary-table--all-ui-side-gamification-calculations`
}

function writeBaseline(found) {
  const byFile = new Map()
  for (const v of found) {
    if (!byFile.has(v.file)) byFile.set(v.file, new Set())
    byFile.get(v.file).add(v.kind)
  }
  const entries = [...byFile.entries()]
    .sort()
    .map(([file, kinds]) => ({
      path: file,
      violations: [...kinds].sort(),
      inventory: inventoryAnchorFor(file),
      removalPhase: removalPhaseFor(file),
      note: 'Phase 0 baseline violation. Removed when this file moves to the single reader/writer.',
    }))
  const doc = {
    $schema: './gamification-allowlist.schema.json',
    description:
      'Shrink-only allowlist of pre-existing gamification boundary violations. Entries may be removed, never added. See docs/gamification-v3/05-current-state-inventory.md.',
    inventory: INVENTORY,
    baselineGeneratedAt: new Date().toISOString().slice(0, 10),
    baselineEntryCount: entries.length,
    entries,
  }
  fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(doc, null, 2)}\n`)
  process.stdout.write(`wrote baseline allowlist: ${entries.length} entries, ${found.length} violations\n`)
}

function validateAllowlist(allowlist) {
  const errors = []
  const seen = new Set()
  const known = new Set(Object.values(VIOLATIONS))

  if (allowlist.inventory !== INVENTORY) errors.push(`allowlist.inventory must be ${INVENTORY}`)
  if (allowlist.entries.length > allowlist.baselineEntryCount) {
    errors.push(
      `allowlist grew: ${allowlist.entries.length} entries > baseline ${allowlist.baselineEntryCount}. The allowlist may only shrink.`,
    )
  }

  for (const entry of allowlist.entries) {
    if (seen.has(entry.path)) errors.push(`duplicate allowlist path: ${entry.path}`)
    seen.add(entry.path)
    if (/[*?]/.test(entry.path) || entry.path.endsWith('/')) {
      errors.push(`wildcard/directory allowlist entry is forbidden: ${entry.path}`)
    }
    if (!fs.existsSync(path.join(ROOT, entry.path))) errors.push(`allowlisted file does not exist: ${entry.path}`)
    if (!isFrontendFile(entry.path)) errors.push(`allowlisted file is outside the enforced scope: ${entry.path}`)
    if (!String(entry.inventory || '').startsWith(`${INVENTORY}#`)) {
      errors.push(`allowlist entry must reference the inventory: ${entry.path}`)
    }
    if (!VALID_PHASES.includes(entry.removalPhase)) {
      errors.push(`allowlist entry must declare a valid removal phase: ${entry.path}`)
    }
    for (const kind of entry.violations || []) {
      if (!known.has(kind)) errors.push(`unknown violation kind '${kind}' in ${entry.path}`)
    }
    if (!entry.violations || entry.violations.length === 0) {
      errors.push(`allowlist entry has no violations listed: ${entry.path}`)
    }
  }
  return errors
}

function main() {
  const found = scanAll()

  if (process.argv.includes('--write-baseline')) {
    writeBaseline(found)
    return
  }

  const allowlist = readAllowlist()
  const errors = validateAllowlist(allowlist)

  const allowed = new Map(allowlist.entries.map((e) => [e.path, new Set(e.violations)]))

  const newViolations = found.filter((v) => !(allowed.get(v.file) || new Set()).has(v.kind))

  const stale = []
  for (const entry of allowlist.entries) {
    const kinds = new Set(found.filter((v) => v.file === entry.path).map((v) => v.kind))
    for (const kind of entry.violations) {
      if (!kinds.has(kind)) stale.push(`${entry.path} :: ${kind}`)
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          totalViolations: found.length,
          filesWithViolations: new Set(found.map((v) => v.file)).size,
          byKind: found.reduce((acc, v) => ({ ...acc, [v.kind]: (acc[v.kind] || 0) + 1 }), {}),
          allowlistEntries: allowlist.entries.length,
          baselineEntryCount: allowlist.baselineEntryCount,
          newViolations: newViolations.length,
          stale,
          errors,
        },
        null,
        2,
      )}\n`,
    )
    process.exit(newViolations.length || stale.length || errors.length ? 1 : 0)
  }

  let failed = false

  if (errors.length) {
    failed = true
    process.stderr.write('\nAllowlist integrity errors:\n')
    for (const e of errors) process.stderr.write(`  ✖ ${e}\n`)
  }

  if (newViolations.length) {
    failed = true
    process.stderr.write('\nNew gamification boundary violations (not allowlisted):\n')
    for (const v of newViolations) {
      process.stderr.write(`  ✖ ${v.file}:${v.line}  [${v.kind}]  ${v.message}\n      ${v.text}\n`)
    }
    process.stderr.write(
      '\nFix the violation, or route the access through src/services/gamification/.\n' +
        'The allowlist may NOT be extended — see docs/gamification-v3/01-architecture.md.\n',
    )
  }

  if (stale.length) {
    failed = true
    process.stderr.write('\nStale allowlist entries — the violation is gone, remove the entry:\n')
    for (const s of stale) process.stderr.write(`  ✖ ${s}\n`)
  }

  if (failed) process.exit(1)

  process.stdout.write(
    `gamification architecture: OK — ${found.length} known violations across ${allowlist.entries.length} allowlisted files ` +
      `(baseline ${allowlist.baselineEntryCount}), 0 new.\n`,
  )
}

module.exports = { scanAll, readAllowlist, validateAllowlist, frontendFiles }

if (require.main === module) main()
