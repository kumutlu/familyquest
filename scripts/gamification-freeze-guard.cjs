#!/usr/bin/env node
/**
 * Gamification V4 — Stage 0 freeze guard (Task 0.2).
 *
 * Rejects any NEW legacy gamification writer that appears outside the approved
 * V4 directories. The V4 rewrite must own every gamification balance write; the
 * legacy client writers in src/lib/api.ts, src/lib/reversalApi.ts and
 * src/lib/behaviour.ts are frozen and must not gain new writers.
 *
 * This script is READ-ONLY with respect to runtime code and production data.
 * It never touches Firestore or any wallet document. It is safe to run at any
 * time and is wired into CI via `npm run ci:freeze`.
 *
 *   node scripts/gamification-freeze-guard.cjs --check   # fail if a new writer exists
 *
 * Design: the guard inspects the working tree diff (added/modified lines) and
 * any untracked files under src/ and functions/src/. A line is a violation only
 * if it matches a forbidden writer pattern AND lives outside the allowed V4
 * directories. On a clean tree (no new writers) the guard exits 0.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')

// Directories where the new V4 system is explicitly allowed to write
// gamification state. Anything outside these is legacy and frozen.
const ALLOWED_DIRS = [
  'src/domain/gamification/v4',
  'functions/src/gamification/v4',
]

// Forbidden writer patterns. Any NEW occurrence of these outside ALLOWED_DIRS
// is a legacy gamification writer that the V4 freeze must reject.
const FORBIDDEN_WRITER_PATTERNS = [
  // direct rewardPoints assignment / object property write, e.g.
  //   transaction.update(userRef, { rewardPoints: currentPoints - cost })
  /\brewardPoints\s*[:=]/,
  // direct lifetimeXP assignment / object property write, e.g.
  //   transaction.update(userRef, { lifetimeXP: +points })
  /\blifetimeXP\s*[:=]/,
]

function isAllowedPath(file) {
  const normalized = file.split(path.sep).join('/')
  return ALLOWED_DIRS.some(
    (dir) => normalized === dir || normalized.startsWith(dir + '/')
  )
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  } catch (err) {
    // Any git failure is treated as a guard failure (fail closed).
    console.error('FREEZE GUARD: git invocation failed: ' + err.message)
    process.exit(1)
  }
}

function collectCandidates() {
  const candidates = [] // { file, line }

  // 1. Added/modified lines in the diff against HEAD (staged + unstaged).
  const diff = git(['diff', 'HEAD', '--', 'src', 'functions/src'])
  let currentFile = null
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      currentFile = raw.slice(4).replace(/^b\//, '')
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (currentFile) {
        candidates.push({ file: currentFile, line: raw.slice(1) })
      }
    }
  }

  // 2. Untracked files under src/ and functions/src/ (full content scan).
  const untracked = git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'src',
    'functions/src',
  ])
  for (const file of untracked.split('\n').filter(Boolean)) {
    let content
    try {
      content = fs.readFileSync(path.join(ROOT, file), 'utf8')
    } catch (err) {
      continue
    }
    for (const line of content.split('\n')) {
      candidates.push({ file, line })
    }
  }

  return candidates
}

function main() {
  const candidates = collectCandidates()
  const violations = []

  for (const { file, line } of candidates) {
    if (isAllowedPath(file)) continue
    for (const pattern of FORBIDDEN_WRITER_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ file, line })
        break
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      'FREEZE GUARD: new legacy gamification writer(s) detected outside V4 directories:'
    )
    for (const v of violations) {
      console.error('  ' + v.file + ': ' + v.line.trim())
    }
    process.exit(1)
  }

  console.log(
    'FREEZE GUARD: no new legacy gamification writers outside V4 directories.'
  )
  process.exit(0)
}

main()
