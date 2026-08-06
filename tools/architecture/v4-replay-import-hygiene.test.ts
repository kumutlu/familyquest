/**
 * Gamification V4 replay — static import-hygiene checks.
 *
 * These assertions inspect module source text on disk, which requires Node
 * APIs (`node:fs`, `node:path`). They live here (tooling/architecture tests,
 * run via `vitest run --dir tools`) rather than under `src/`, whose tsconfig
 * is browser-oriented and intentionally excludes Node types.
 *
 * Moved verbatim (behaviour-preserving) from:
 * - src/domain/gamification/v4/replay/sources.test.ts
 * - src/domain/gamification/v4/replay/classify.test.ts
 * - src/domain/gamification/v4/replay/report.test.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPLAY_DIR = resolve(process.cwd(), 'src/domain/gamification/v4/replay')

function readSource(fileName: string): string {
  return readFileSync(resolve(REPLAY_DIR, fileName), 'utf8')
}

describe('sources.ts — read-only guarantee', () => {
  const SRC = readSource('sources.ts')

  it('never imports wallet modules', () => {
    expect(SRC).not.toMatch(/from\s+['"][^'"]*wallet[^'"]*['"]/)
  })

  it('never imports firebase (no Firestore writes)', () => {
    expect(SRC).not.toMatch(/from\s+['"]firebase/)
  })

  it('does not import or re-implement the projection reducer', () => {
    expect(SRC).not.toMatch(/from\s+['"]\.\/reducer['"]/)
    expect(SRC).not.toMatch(/reduceGamificationEventsV4|foldEvent/)
  })
})

describe('classify.ts — hard constraints: no wallet / no Firestore', () => {
  const src = readSource('classify.ts')

  it('does not import any wallet module', () => {
    // Only flag actual import/require statements on a single line, not doc comments.
    expect(src).not.toMatch(/import\s+[^;;\n]*wallet/i)
    expect(src).not.toMatch(/require\([^)\n]*wallet/i)
  })

  it('does not import firebase / firestore (no writes)', () => {
    expect(src).not.toMatch(/import\s+[^;;\n]*firebase/i)
    expect(src).not.toMatch(/import\s+[^;;\n]*firestore/i)
    expect(src).not.toMatch(/require\([^)\n]*firebase/i)
    expect(src).not.toMatch(/require\([^)\n]*firestore/i)
  })
})

describe('report.ts — import hygiene', () => {
  const src = readSource('report.ts')

  it('never imports wallet code', () => {
    expect(src.toLowerCase().includes('wallet')).toBe(false)
  })

  it('never imports Firestore', () => {
    expect(/firestore|admin-firestore|@firebase\/firestore/i.test(src)).toBe(false)
  })
})
