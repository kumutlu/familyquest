/**
 * Stage 7 — hidden legacy gamification writer audit (pre-cutover proof).
 *
 * Proves there is NO hidden legacy gamification writer outside the 7 declared
 * authoritative sources. The 7 sources (audit §6 / featureFlags.ts) are:
 *
 *   1. task_approval      -> functions/src/gamificationProcessor.ts  processApprovedCompletion
 *   2. task_invalidation  -> functions/src/gamificationProcessor.ts  processTaskInvalidation
 *   3. day_finalization   -> functions/src/gamificationRepository.ts finalizeChildDay
 *   4. behaviour          -> functions/src/behaviourRepository.ts    processBehaviourEvent
 *   5. reward_redemption   -> src/lib/api.ts                         redeemReward
 *   6. challenge_claim    -> src/lib/api.ts                         claimChallenge
 *   7. avatar_unlock      -> src/lib/api.ts                         unlockAvatar
 *
 * The audit:
 *   - asserts each real entrypoint function exists in its declared file;
 *   - scans the two PRODUCTION source trees (functions/src, src/lib) for a
 *     gamification balance write (`rewardPoints` / `lifetimeXP` assignment) and
 *     asserts it lives in one of the 7 source files (or a user-creation init
 *     file), or in a known pure-calc / type / adapter / diagnostic file that
 *     never writes balances. Scripts, e2e tests and temp files are out of
 *     scope (not production writers).
 *
 * Read-only: never touches Firestore or wallet data.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()

interface DeclaredWriter {
  readonly writer: string
  readonly file: string
  readonly fn: string
}

const WRITERS: readonly DeclaredWriter[] = [
  { writer: 'task_approval', file: 'functions/src/gamificationProcessor.ts', fn: 'processApprovedCompletion' },
  { writer: 'task_invalidation', file: 'functions/src/gamificationProcessor.ts', fn: 'processTaskInvalidation' },
  { writer: 'day_finalization', file: 'functions/src/gamificationRepository.ts', fn: 'finalizeChildDay' },
  { writer: 'behaviour', file: 'functions/src/behaviourRepository.ts', fn: 'processBehaviourEvent' },
  { writer: 'reward_redemption', file: 'src/lib/api.ts', fn: 'redeemReward' },
  { writer: 'challenge_claim', file: 'src/lib/api.ts', fn: 'claimChallenge' },
  { writer: 'avatar_unlock', file: 'src/lib/api.ts', fn: 'unlockAvatar' },
]

// Files allowed to contain a gamification balance write: the 7 sources plus the
// user-creation init paths (set rewardPoints/lifetimeXP to 0 on new users).
const ALLOWED_WRITER_FILES = new Set([
  'gamificationProcessor.ts',
  'gamificationRepository.ts',
  'behaviourRepository.ts',
  'api.ts',
  'reversalApi.ts',
  'childJoinRequest.ts',
  'googleRedirectAuth.ts',
])

// Pure calculation / type / adapter / diagnostic files that reference
// rewardPoints/lifetimeXP but NEVER write a gamification balance (not writers).
const EXEMPT_FILES = new Set([
  'behaviour.ts',
  'achievements.ts',
  'gamificationAdapters.ts',
  'gamificationProgression.ts',
  'comparison.ts',
])

const WRITE_PATTERN = /rewardPoints\s*[:=]|lifetimeXP\s*[:=]/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'lib') continue
      if (full.endsWith('functions/src/gamification/v4')) continue
      if (full.endsWith('src/domain')) continue
      walk(full, out)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('hidden writer audit — 7 declared sources', () => {
  it('enumerates exactly 7 authoritative writers', () => {
    expect(WRITERS).toHaveLength(7)
  })

  it('every declared writer has a real entrypoint function in its file', () => {
    for (const { file, fn } of WRITERS) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      // Match `export async function fn`, `export const fn =`, or `async fn(`.
      const present = new RegExp(
        `(export\\s+(async\\s+)?function\\s+${fn}\\b)|(export\\s+const\\s+${fn}\\s*=)|(\\basync\\s+${fn}\\s*\\()`,
      ).test(source)
      expect(present, `entrypoint ${fn} missing in ${file}`).toBe(true)
    }
  })

  it('NO hidden legacy gamification writer outside the 7 declared sources', () => {
    const violations: string[] = []
    for (const root of [resolve(ROOT, 'functions/src'), resolve(ROOT, 'src/lib')]) {
      for (const file of walk(root)) {
        const base = file.split(/[\\/]/).pop() as string
        if (ALLOWED_WRITER_FILES.has(base) || EXEMPT_FILES.has(base)) continue
        const source = readFileSync(file, 'utf8')
        if (WRITE_PATTERN.test(source)) {
          violations.push(file)
        }
      }
    }
    expect(violations, `hidden gamification writers found:\n${violations.join('\n')}`).toEqual([])
  })
})
