/**
 * Structural tests for the `no-gamification-firestore` architecture rule.
 *
 * Phase 0 of the Gamification V3 plan. These tests describe the boundary the
 * rule must enforce; they do not touch runtime behaviour.
 *
 * See docs/gamification-v3/05-current-state-inventory.md
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { analyze, VIOLATIONS } = require_('./no-gamification-firestore.cjs') as {
  analyze: (filename: string, source: string) => Array<{ kind: string; line: number; message: string }>
  VIOLATIONS: Record<string, string>
}

const kinds = (filename: string, source: string) => analyze(filename, source).map((v) => v.kind)

describe('no-gamification-firestore — direct user balance reads', () => {
  it('fails a direct users.rewardPoints read in a page', () => {
    const source = `
      export function Rewards({ currentUser }) {
        if (currentUser.rewardPoints < cost) return null
        return null
      }
    `
    expect(kinds('src/pages/Rewards.tsx', source)).toContain(VIOLATIONS.USER_BALANCE_READ)
  })

  it('fails a direct users.lifetimeXP read in a component', () => {
    const source = `
      export const Card = ({ child }) => <span>{child.lifetimeXP || 0}</span>
    `
    expect(kinds('src/components/parent/ChildCard.tsx', source)).toContain(VIOLATIONS.USER_BALANCE_READ)
  })

  it('fails a direct users.currentStreak read in a page', () => {
    const source = `export const D = ({ user }) => <b>{user.currentStreak || 0}</b>`
    expect(kinds('src/pages/Dashboard.tsx', source)).toContain(VIOLATIONS.USER_BALANCE_READ)
  })
})

describe('no-gamification-firestore — direct projection reads', () => {
  it('fails a direct gamification_summaries read outside the approved service', () => {
    const source = `
      import { collection } from 'firebase/firestore'
      const q = collection(db, \`families/\${familyId}/gamification_summaries\`)
    `
    expect(kinds('src/lib/bootstrapQueries.ts', source)).toContain(VIOLATIONS.SUMMARY_READ)
  })

  it('fails a direct gamification_state read outside the approved service', () => {
    const source = `const ref = doc(db, 'families/f/gamification_state/m')`
    expect(kinds('src/pages/Family.tsx', source)).toContain(VIOLATIONS.SUMMARY_READ)
  })

  it('fails importing firebase/firestore in a file that touches gamification', () => {
    const source = `
      import { doc, getDoc } from 'firebase/firestore'
      const snap = await getDoc(doc(db, 'families/f/gamification_events/e'))
    `
    expect(kinds('src/pages/Family.tsx', source)).toContain(VIOLATIONS.FIRESTORE_IMPORT)
  })
})

describe('no-gamification-firestore — gamification writes', () => {
  it('fails a client write to rewardPoints', () => {
    const source = `
      transaction.update(userRef, { rewardPoints: currentPoints - cost })
    `
    expect(kinds('src/lib/api.ts', source)).toContain(VIOLATIONS.BALANCE_WRITE)
  })

  it('fails a client write to lifetimeXP', () => {
    const source = `await updateDoc(userRef, { lifetimeXP: (data.lifetimeXP || 0) + points })`
    expect(kinds('src/lib/api.ts', source)).toContain(VIOLATIONS.BALANCE_WRITE)
  })

  it('fails a client write to a streak field', () => {
    const source = `transaction.update(userRef, { currentStreak: newCurrentStreak })`
    expect(kinds('src/lib/api.ts', source)).toContain(VIOLATIONS.BALANCE_WRITE)
  })

  it('fails a client write to level', () => {
    const source = `setDoc(ref, { level: nextLevel })`
    expect(kinds('src/lib/api.ts', source)).toContain(VIOLATIONS.BALANCE_WRITE)
  })
})

describe('no-gamification-firestore — local arithmetic', () => {
  it('fails a local XP sum in a page', () => {
    const source = `const totalFamilyXP = children.reduce((acc, c) => acc + (c.lifetimeXP || 0), 0)`
    expect(kinds('src/pages/Family.tsx', source)).toContain(VIOLATIONS.GAMIFICATION_ARITHMETIC)
  })

  it('fails weekly aggregation from task completions', () => {
    const source = `
      const membersWithWeeklyXP = members.map((member) => {
        let weeklyXP = 0
        completions.forEach((completion) => {
          const task = tasks.find((t) => t.id === completion.taskId)
          if (task) weeklyXP += (task.pointsReward || 0)
        })
        return { ...member, weeklyXP }
      })
    `
    expect(kinds('src/pages/Family.tsx', source)).toContain(VIOLATIONS.WEEKLY_FROM_COMPLETIONS)
  })

  it('fails a local level calculation', () => {
    const source = `const level = Math.floor(xpTotal / XP_PER_LEVEL) + 1`
    expect(kinds('src/lib/gamificationAdapters.ts', source)).toContain(VIOLATIONS.LOCAL_LEVEL_FORMULA)
  })

  it('fails an inline level progress percentage', () => {
    const source = `const levelProgress = (summary.xpProgressInLevel / 1000) * 100`
    expect(kinds('src/components/dashboard/GamificationSummaryCard.tsx', source)).toContain(
      VIOLATIONS.LOCAL_LEVEL_FORMULA,
    )
  })
})

describe('no-gamification-firestore — approved locations', () => {
  it('passes the approved useGamification service', () => {
    const source = `
      import { doc, onSnapshot } from 'firebase/firestore'
      export function useGamification(memberId: string) {
        const ref = doc(db, \`families/\${familyId}/gamification_state/\${memberId}\`)
        return useSnapshot(ref)
      }
    `
    expect(analyze('src/services/gamification/useGamification.ts', source)).toEqual([])
  })

  it('passes pure domain code with canonical formulas', () => {
    const source = `
      export function levelProgressForXp(xpTotal: number, perLevel: number) {
        return { level: Math.floor(xpTotal / perLevel) + 1, xpIntoLevel: xpTotal % perLevel }
      }
    `
    expect(analyze('src/domain/gamification/level.ts', source)).toEqual([])
  })

  it('leaves server function code unaffected', () => {
    const source = `
      await userRef.update({ rewardPoints: next, lifetimeXP: nextXp })
      const summary = db.collection('gamification_summaries')
    `
    expect(analyze('functions/src/gamificationRepository.ts', source)).toEqual([])
  })

  it('leaves migration scripts unaffected', () => {
    const source = `await userRef.update({ lifetimeXP: 0 })`
    expect(analyze('scripts/migrate-legacy-xp.ts', source)).toEqual([])
  })

  it('leaves tests unaffected', () => {
    const source = `expect(user.rewardPoints).toBe(10)`
    expect(analyze('src/pages/Rewards.test.tsx', source)).toEqual([])
  })

  it('allows formatting a value supplied by the read model', () => {
    const source = `
      const g = useGamification(memberId)
      return <span>{formatNumber(g.rewardPoints)}</span>
    `
    expect(analyze('src/pages/Rewards.tsx', source)).toEqual([])
  })
})

describe('no-gamification-firestore — allowlist behaviour', () => {
  it('passes an allowlisted legacy file temporarily', () => {
    const source = `if (currentUser.rewardPoints < cost) return null`
    const allowlist = {
      entries: [
        {
          path: 'src/pages/Rewards.tsx',
          violations: ['user-balance-read'],
          inventory: 'docs/gamification-v3/05-current-state-inventory.md#4-summary-table',
          removalPhase: 'Phase 4',
          note: 'R3',
        },
      ],
    }
    expect(analyze('src/pages/Rewards.tsx', source).filter((v) => !isAllowed(allowlist, 'src/pages/Rewards.tsx', v.kind))).toEqual([])
  })

  it('fails a non-allowlisted violation even when other files are allowlisted', () => {
    const source = `if (currentUser.rewardPoints < cost) return null`
    const allowlist = {
      entries: [
        {
          path: 'src/pages/Rewards.tsx',
          violations: ['user-balance-read'],
          inventory: 'docs/gamification-v3/05-current-state-inventory.md#4-summary-table',
          removalPhase: 'Phase 4',
          note: 'R3',
        },
      ],
    }
    const found = analyze('src/pages/BrandNewPage.tsx', source).filter(
      (v) => !isAllowed(allowlist, 'src/pages/BrandNewPage.tsx', v.kind),
    )
    expect(found.length).toBeGreaterThan(0)
  })

  it('fails an allowlisted file for a violation kind it is not allowlisted for', () => {
    const source = `const totalFamilyXP = children.reduce((acc, c) => acc + (c.lifetimeXP || 0), 0)`
    const allowlist = {
      entries: [
        {
          path: 'src/pages/Family.tsx',
          violations: ['user-balance-read'],
          inventory: 'docs/gamification-v3/05-current-state-inventory.md#4-summary-table',
          removalPhase: 'Phase 4',
          note: 'partial',
        },
      ],
    }
    const found = analyze('src/pages/Family.tsx', source).filter(
      (v) => !isAllowed(allowlist, 'src/pages/Family.tsx', v.kind),
    )
    expect(found.length).toBeGreaterThan(0)
  })
})

function isAllowed(
  allowlist: { entries: Array<{ path: string; violations: string[] }> },
  file: string,
  kind: string,
): boolean {
  const entry = allowlist.entries.find((e) => e.path === file)
  return Boolean(entry && entry.violations.includes(kind))
}

describe('no-gamification-firestore — rule shape', () => {
  it('exposes an ESLint-compatible rule module', () => {
    const mod = require_('./no-gamification-firestore.cjs')
    expect(mod.rule).toBeTruthy()
    expect(mod.rule.meta.type).toBe('problem')
    expect(typeof mod.rule.create).toBe('function')
  })

  it('reports through the ESLint context', () => {
    const mod = require_('./no-gamification-firestore.cjs')
    const reports: Array<{ messageId?: string }> = []
    const context = {
      filename: 'src/pages/Rewards.tsx',
      getFilename: () => 'src/pages/Rewards.tsx',
      sourceCode: { getText: () => 'const p = currentUser.rewardPoints' },
      getSourceCode() {
        return this.sourceCode
      },
      report: (d: { messageId?: string }) => reports.push(d),
      options: [],
    }
    const visitor = mod.rule.create(context)
    visitor.Program({ type: 'Program', loc: { start: { line: 1, column: 0 } } })
    expect(reports.length).toBeGreaterThan(0)
  })
})
