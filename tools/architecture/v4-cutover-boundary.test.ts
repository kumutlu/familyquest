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

// Task 7.1 activation readiness: the deploy entry MAY reference exactly THREE
// V4 modules — the task-approval adapter (engine injection) and the READ-ONLY
// Stage 7 evidence provider plus its parameter-only Gate 1 loader. All are
// non-writing. Everything else stays unreachable from the deployed bundle.
const INDEX_V4_ALLOWLIST = [
  './gamification/v4/taskApprovalAdapter',
  './gamification/v4/stage7EvidenceProvider',
  './gamification/v4/provisionedGate1Artifact',
]

describe('Stage 7 boundary — only the task-approval adapter is reachable from deploy', () => {
  const index = readFileSync(FUNCTIONS_INDEX, 'utf8')

  it('every gamification/v4 reference in index.ts is on the allowlist', () => {
    const refs = [...index.matchAll(/['"]([^'"]*gamification\/v4[^'"]*)['"]/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(INDEX_V4_ALLOWLIST).toContain(ref)
  })

  it('index.ts injects the V4 engine but never flips a route to v4', () => {
    expect(index).toContain('createV4TaskApprovalEngine')
    // Task 7.1: the real Stage 7 verifier replaces `denyStage7ByDefault`.
    expect(index).toContain('createStage7WriterVerifier')
    expect(index).not.toContain('denyStage7ByDefault')
    expect(index).not.toMatch(/setRouteResolver|setWriterFlag|activateStage7/)
  })

  it('index.ts embeds NO Stage 7 evidence: it is loaded read-only, fails closed unprovisioned', () => {
    expect(index).toContain('createStage7EvidenceProvider')
    // No inline/static evidence object and no approved artifact baked into the bundle.
    expect(index).not.toMatch(/evidence:\s*\{/)
    expect(index).not.toContain('GATE_1_REACHED')
    // The artifact is supplied through supported parameterized configuration;
    // absent/malformed => null => blocked.
    const loader = readFileSync(resolve(FUNCTIONS_V4_DIR, 'provisionedGate1Artifact.ts'), 'utf8')
    expect(loader).toContain("defineString('STAGE7_GATE1_ARTIFACT'")
    expect(index).toContain('loadProvisionedGate1Artifact')
    expect(index).not.toContain('applicationDefault')
  })
})

describe('Stage 7 boundary — client-facing code cannot import the server V4 repository', () => {
  const CLIENT_DIRS = [resolve(ROOT, 'src')]

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  it('no src/ module imports functions/src/gamification/v4', () => {
    const offenders = CLIENT_DIRS.flatMap(walk).filter((file) =>
      /from ['"][^'"]*functions\/src\/gamification\/v4/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
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
    // Only the Task 7.1 adapter may be referenced by the deploy entry.
    const refs = [...index.matchAll(/['"]([^'"]*gamification\/v4[^'"]*)['"]/g)].map((m) => m[1])
    for (const ref of refs) expect(INDEX_V4_ALLOWLIST).toContain(ref)
  })

  it('Stage 7 infrastructure modules are NOT referenced by functions/src/index.ts by name', () => {
    const index = readFileSync(FUNCTIONS_INDEX, 'utf8')
    for (const name of ['cutoverConfig', 'stage7Gate', 'rollback', 'featureFlags', 'stage7Readiness']) {
      expect(index).not.toContain(name)
    }
  })

  it('the Stage 7 verifier delegates to the existing gate chain and never writes', () => {
    const source = readFileSync(resolve(FUNCTIONS_V4_DIR, 'stage7Verifier.ts'), 'utf8')
    expect(source).toContain('assertWriterCutoverAllowed')
    expect(source).not.toMatch(/\.(set|update|create|delete)\(/)
  })

  it('the Stage 7 evidence provider is READ-ONLY and does not duplicate Stage 6', () => {
    const source = readFileSync(resolve(FUNCTIONS_V4_DIR, 'stage7EvidenceProvider.ts'), 'utf8')
    // No Firestore mutation of any kind (`.update(` alone would match the
    // sha256 hasher, so document mutations are matched precisely).
    expect(source).not.toMatch(/\.(set|create|delete)\(/)
    expect(source).not.toMatch(/\.doc\([^)]*\)\.(set|update|delete)\(/)
    expect(source).not.toMatch(/\bref\.(set|update|delete)\(/)
    expect(source).not.toMatch(/runTransaction|batch\(/)
    // Stage 6 stays in scripts/verify/pre-cutover.ts (single implementation).
    expect(source).not.toMatch(/function\s+verifyPreCutover/)
    expect(source).toContain('gamification_migration_marker/marker')
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
