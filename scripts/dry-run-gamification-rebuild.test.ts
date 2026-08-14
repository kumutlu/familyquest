import { describe, expect, it } from 'vitest'
import { buildDryRunChildReport } from './dry-run-gamification-rebuild'

const at = (value: number) => ({ toMillis: () => value })

describe('read-only gamification rebuild report', () => {
  it('reports canonical delta and legacy normalization without writes', () => {
    const report = buildDryRunChildReport({
      familyId: 'family', childId: 'child', currentXp: 557, processingAt: 2_000,
      events: [
        { id: 'baseline', data: { schemaVersion: 1, familyId: 'family', childId: 'child', eventType: 'legacy_xp_baseline', xpDelta: 380,
          sourceType: 'migration', sourceId: 'legacy', idempotencyKey: 'baseline', causalGroupId: 'baseline', transitionRank: 0,
          effectiveAt: at(1), createdAt: at(1), configSchemaVersion: 1, createdBy: 'legacy-xp-migration-v1' } },
        { id: 'behaviour_xp_backfill:source', data: { childId: 'child', eventType: 'xp_backfill', sourceId: 'source', xpDelta: 20,
          effectiveAt: at(2), createdAt: at(2) } },
        { id: 'task_xp:task_v1|child|task|2026-08-03', data: { childId: 'child', eventType: 'task_completion', sourceId: 'completion', xpDelta: 397,
          effectiveAt: at(3), createdAt: at(3) } },
      ],
    })

    expect(report).toMatchObject({ currentXp: 557, canonicalXp: 797, delta: 240, eventCount: 3, legacyNormalized: 2,
      unknownEvents: 0, duplicateRewardApplications: 0, level: 1, xpToNextLevel: 203 })
  })
})
