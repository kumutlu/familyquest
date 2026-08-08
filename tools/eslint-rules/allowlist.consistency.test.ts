/**
 * Repository inventory / allowlist consistency tests.
 *
 * The allowlist is a shrink-only ratchet: it records the gamification boundary
 * violations that existed at the Phase 0 baseline. It may never grow, every
 * entry must be traceable to the inventory document, and every entry must
 * declare the phase in which it is removed.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const allowlist = require_('./gamification-allowlist.json') as {
  baselineEntryCount: number
  baselineGeneratedAt: string
  inventory: string
  entries: Array<{
    path: string
    violations: string[]
    inventory: string
    removalPhase: string
    note: string
  }>
}

const { VIOLATIONS, analyze, isFrontendFile } = require_('./no-gamification-firestore.cjs') as {
  VIOLATIONS: Record<string, string>
  analyze: (filename: string, source: string) => Array<{ kind: string }>
  isFrontendFile: (filename: string) => boolean
}

const inventoryText = fs.readFileSync(path.join(ROOT, 'docs/gamification-v3/05-current-state-inventory.md'), 'utf8')

const VALID_PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6']

describe('gamification allowlist — structural integrity', () => {
  it('points at the inventory document', () => {
    expect(allowlist.inventory).toBe('docs/gamification-v3/05-current-state-inventory.md')
    expect(fs.existsSync(path.join(ROOT, allowlist.inventory))).toBe(true)
  })

  it('has no duplicate allowlist paths', () => {
    const paths = allowlist.entries.map((e) => e.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('has no wildcard entry covering an entire directory', () => {
    for (const entry of allowlist.entries) {
      expect(entry.path).not.toMatch(/[*?]/)
      expect(entry.path.endsWith('/')).toBe(false)
    }
  })

  it('references only files that exist', () => {
    for (const entry of allowlist.entries) {
      expect(fs.existsSync(path.join(ROOT, entry.path)), `missing: ${entry.path}`).toBe(true)
    }
  })

  it('references only files inside the enforced frontend scope', () => {
    for (const entry of allowlist.entries) {
      expect(isFrontendFile(entry.path), `out of scope: ${entry.path}`).toBe(true)
    }
  })

  it('uses only known violation kinds', () => {
    const known = new Set(Object.values(VIOLATIONS))
    for (const entry of allowlist.entries) {
      expect(entry.violations.length).toBeGreaterThan(0)
      for (const kind of entry.violations) {
        expect(known.has(kind), `unknown kind ${kind} in ${entry.path}`).toBe(true)
      }
      expect(new Set(entry.violations).size).toBe(entry.violations.length)
    }
  })
})

describe('gamification allowlist — traceability to the inventory', () => {
  it('every allowlist entry exists in the inventory document', () => {
    for (const entry of allowlist.entries) {
      expect(inventoryText.includes(entry.path), `not in inventory: ${entry.path}`).toBe(true)
    }
  })

  it('every allowlist entry cites an inventory section', () => {
    for (const entry of allowlist.entries) {
      expect(entry.inventory, `no inventory reference: ${entry.path}`).toMatch(
        /^docs\/gamification-v3\/05-current-state-inventory\.md#/,
      )
    }
  })

  it('every allowlist entry declares a valid removal phase', () => {
    for (const entry of allowlist.entries) {
      expect(VALID_PHASES, `bad phase for ${entry.path}`).toContain(entry.removalPhase)
    }
  })

  it('every inventory item marked TEMPORARY COMPATIBILITY has a removal phase', () => {
    // Per-file disposition headings look like:
    //   #### `path` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low
    const items = inventoryText
      .split('\n')
      .filter((l) => l.startsWith('####') && l.includes('TEMPORARY COMPATIBILITY'))
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(/Phase\s\d/.test(item), `no removal phase: ${item.slice(0, 120)}`).toBe(true)
    }
  })

  it('marks no allowlisted frontend file as TEMPORARY COMPATIBILITY without a phase', () => {
    for (const entry of allowlist.entries) {
      expect(VALID_PHASES).toContain(entry.removalPhase)
    }
  })
})

describe('gamification allowlist — shrink-only ratchet', () => {
  it('never grows beyond the recorded Phase 0 baseline', () => {
    expect(allowlist.entries.length).toBeLessThanOrEqual(allowlist.baselineEntryCount)
  })

  it('records the baseline count agreed in the Phase 0 baseline report', () => {
    const baseline = fs.readFileSync(path.join(ROOT, 'docs/gamification-v3/06-phase-0-baseline.md'), 'utf8')
    expect(baseline).toContain(`allowlist entries | ${allowlist.baselineEntryCount}`)
  })

  it('contains no stale entry — every allowlisted file still violates the rule', () => {
    const stale: string[] = []
    for (const entry of allowlist.entries) {
      const source = fs.readFileSync(path.join(ROOT, entry.path), 'utf8')
      const found = new Set(analyze(entry.path, source).map((v) => v.kind))
      for (const kind of entry.violations) {
        if (!found.has(kind)) stale.push(`${entry.path} :: ${kind}`)
      }
    }
    expect(stale, 'remove these allowlist entries — the violation is gone').toEqual([])
  })
})
