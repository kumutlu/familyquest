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
