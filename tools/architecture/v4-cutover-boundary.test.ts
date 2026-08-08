/**
 * Cutover readiness audit — Stage 7 boundary guard (test-only, no production
 * behaviour change).
 *
 * Stage 7 (writer cutover) is NOT authorised. These static checks fail closed
 * if any V4 module silently becomes a production write path before GATE 3:
 *
 *   1. `functions/src/index.ts` must not import or re-export any
 *      `gamification/v4` module (no deployed V4 trigger/callable/schedule).
 *   2. Every exported async I/O entry point in `functions/src/gamification/v4`
 *      must call `assertEmulatorOnly(...)` as its emulator kill-switch.
 *   3. The V4 domain layer (`src/domain/gamification/v4`) must remain pure:
 *      no firebase / firebase-admin imports.
 *
 * Read-only: never touches Firestore, functions runtime, or wallet data.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const FUNCTIONS_INDEX = resolve(ROOT, 'functions/src/index.ts')
const FUNCTIONS_V4_DIR = resolve(ROOT, 'functions/src/gamification/v4')
const DOMAIN_V4_DIR = resolve(ROOT, 'src/domain/gamification/v4')

// Stage 7 infrastructure modules added by the P0 (audit B3 + R1). None of these
// may become a deployed production write path; each is pinned by the checks below.
const NEW_FUNCTIONS_FILES: ReadonlyArray<{ file: string; guardedFns: string[] }> = [
  { file: 'cutoverConfig.ts', guardedFns: ['readCutoverConfig', 'writeCutoverConfig', 'activateStage7', 'setWriterFlag'] },
  { file: 'stage7Gate.ts', guardedFns: ['checkStage7Allowed', 'assertStage7Allowed', 'assertWriterCutoverAllowed'] },
  { file: 'rollback.ts', guardedFns: ['rollbackStage7', 'purgeV4FamilyData', 'recordRollbackEvent'] },
]
const NEW_DOMAIN_FILES = ['featureFlags.ts', 'stage7Readiness.ts']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
}

describe('Stage 7 boundary — no deployed V4 production write path', () => {
  it('functions/src/index.ts does not reference any gamification/v4 module', () => {
    const index = readFileSync(FUNCTIONS_INDEX, 'utf8')
    expect(index).not.toMatch(/gamification\/v4/)
  })
})

describe('Stage 4 repository — emulator kill-switch on every I/O entry point', () => {
  const files = sourceFiles(FUNCTIONS_V4_DIR)

  it('has at least one V4 functions module to guard', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file}: every exported async function asserts emulator-only`, () => {
      const source = readFileSync(resolve(FUNCTIONS_V4_DIR, file), 'utf8')
      const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1])
      for (const fn of exported) {
        // The body between this declaration and the next export must contain
        // the kill-switch call.
        const start = source.indexOf(`export async function ${fn}`)
        const nextExport = source.indexOf('\nexport ', start + 1)
        const body = source.slice(start, nextExport === -1 ? undefined : nextExport)
        expect(body, `${file}#${fn} is missing assertEmulatorOnly`).toMatch(
          /assertEmulatorOnly\(/,
        )
      }
    })
  }
})

describe('V4 domain layer purity', () => {
  for (const file of sourceFiles(DOMAIN_V4_DIR)) {
    it(`${file} imports no firebase SDK`, () => {
      const source = readFileSync(resolve(DOMAIN_V4_DIR, file), 'utf8')
      expect(source).not.toMatch(/from ['"]firebase(-admin)?/)
    })
  }
})

// ---------------------------------------------------------------------------
// Stage 7 infrastructure boundary (audit B3 + R1) — added by the P0.
// These checks fail closed if any new module silently becomes a production
// write path or drops the emulator kill-switch.
// ---------------------------------------------------------------------------

describe('Stage 7 infrastructure — files exist and stay non-production', () => {
  for (const { file } of NEW_FUNCTIONS_FILES) {
    it(`${file} exists in the V4 functions dir`, () => {
      expect(() => readFileSync(resolve(FUNCTIONS_V4_DIR, file), 'utf8')).not.toThrow()
    })
  }
  for (const file of NEW_DOMAIN_FILES) {
    it(`${file} exists in the V4 domain dir`, () => {
      expect(() => readFileSync(resolve(DOMAIN_V4_DIR, file), 'utf8')).not.toThrow()
    })
  }

  it('functions/src/index.ts does NOT import any Stage 7 infrastructure module', () => {
    const index = readFileSync(FUNCTIONS_INDEX, 'utf8')
    // The whole gamification/v4 dir must stay unreferenced by the deploy entry.
    expect(index).not.toMatch(/gamification\/v4/)
  })

  it('Stage 7 infrastructure modules are NOT referenced by functions/src/index.ts by name', () => {
    const index = readFileSync(FUNCTIONS_INDEX, 'utf8')
    for (const name of ['cutoverConfig', 'stage7Gate', 'rollback', 'featureFlags', 'stage7Readiness']) {
      expect(index).not.toContain(name)
    }
  })
})

describe('Stage 7 infrastructure — emulator kill-switch on every new I/O entry point', () => {
  for (const { file, guardedFns } of NEW_FUNCTIONS_FILES) {
    const source = readFileSync(resolve(FUNCTIONS_V4_DIR, file), 'utf8')
    for (const fn of guardedFns) {
      it(`${file}#${fn} asserts emulator-only`, () => {
        const start = source.indexOf(`export async function ${fn}`)
        expect(start, `${file} is missing exported async ${fn}`).toBeGreaterThanOrEqual(0)
        const nextExport = source.indexOf('\nexport ', start + 1)
        const body = source.slice(start, nextExport === -1 ? undefined : nextExport)
        expect(body, `${file}#${fn} is missing assertEmulatorOnly`).toMatch(/assertEmulatorOnly\(/)
      })
    }
  }
})

describe('Stage 7 infrastructure — new domain modules stay pure', () => {
  for (const file of NEW_DOMAIN_FILES) {
    it(`${file} imports no firebase SDK`, () => {
      const source = readFileSync(resolve(DOMAIN_V4_DIR, file), 'utf8')
      expect(source).not.toMatch(/from ['"]firebase(-admin)?/)
    })
  }
})
