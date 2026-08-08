/**
 * Gamification V4 — Phase 1 (B1): Gate 1 evidence artifact.
 *
 * TDD-first. The artifact is DERIVED (never invented) from the already-approved
 * Stage 3 production replay report. Owner approval is supplied separately and is
 * NEVER fabricated. Anything malformed/ambiguous/unaccounted FAILS CLOSED.
 */

import { describe, it, expect } from 'vitest'

import {
  buildGate1Artifact,
  validateGate1Artifact,
  classifyFamily,
  hashGate1Report,
  Gate1EvidenceError,
  GATE1_ARTIFACT_VERSION,
  type Gate1SourceReport,
  type OwnerApproval,
} from './gate1-artifact'

const OWNER: OwnerApproval = {
  approvedBy: 'owner@example.com',
  approvedAt: '2026-08-08T10:00:00.000Z',
  approvalRef: 'GATE1-2026-08-08',
}

const NOW = Date.parse('2026-08-08T10:05:00.000Z')

function sourceReport(overrides: Partial<Gate1SourceReport> = {}): Gate1SourceReport {
  return {
    gate: 'GATE_1_REACHED',
    schemaVersion: 1,
    totalFamilies: 2,
    totalSources: 6,
    totalEventsBuilt: 6,
    counts: { exact: 4, estimated: 2, malformed: 0, ambiguous: 0, skipped: 0 },
    families: [
      {
        familyId: 'FAM_A',
        totalSources: 4,
        eventsBuilt: 4,
        counts: { exact: 4, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        members: { m1: { memberId: 'm1' } },
        displayedProvided: true,
      },
      {
        familyId: 'FAM_B',
        totalSources: 2,
        eventsBuilt: 2,
        counts: { exact: 0, estimated: 2, malformed: 0, ambiguous: 0, skipped: 0 },
        members: { m2: { memberId: 'm2' } },
        displayedProvided: true,
      },
    ],
    walletSnapshot: null,
    ...overrides,
  } as Gate1SourceReport
}

describe('Phase 1 — classifyFamily (derived, never invented)', () => {
  it('EXACT when every source replayed exactly', () => {
    expect(
      classifyFamily({
        familyId: 'F',
        totalSources: 3,
        eventsBuilt: 3,
        counts: { exact: 3, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
      }).classification,
    ).toBe('exact')
  })

  it('ESTIMATED when some sources used the documented estimate fallback', () => {
    expect(
      classifyFamily({
        familyId: 'F',
        totalSources: 3,
        eventsBuilt: 3,
        counts: { exact: 1, estimated: 2, malformed: 0, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
      }).classification,
    ).toBe('estimated')
  })

  it('NO_ACTIVITY when the family has zero replayable sources', () => {
    expect(
      classifyFamily({
        familyId: 'F',
        totalSources: 0,
        eventsBuilt: 0,
        counts: { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
      }).classification,
    ).toBe('no_activity')
  })

  it('FAILS CLOSED on malformed sources', () => {
    expect(() =>
      classifyFamily({
        familyId: 'F',
        totalSources: 2,
        eventsBuilt: 1,
        counts: { exact: 1, estimated: 0, malformed: 1, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
      }),
    ).toThrow(Gate1EvidenceError)
  })

  it('FAILS CLOSED on ambiguous sources', () => {
    expect(() =>
      classifyFamily({
        familyId: 'F',
        totalSources: 2,
        eventsBuilt: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 1, skipped: 0 },
        members: {},
        displayedProvided: true,
      }),
    ).toThrow(/ambiguous/i)
  })

  it('FAILS CLOSED when classified counts do not account for every source', () => {
    expect(() =>
      classifyFamily({
        familyId: 'F',
        totalSources: 5,
        eventsBuilt: 3,
        counts: { exact: 3, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
      }),
    ).toThrow(/unaccounted/i)
  })

  it('FAILS CLOSED when the replay recorded a family-level error', () => {
    expect(() =>
      classifyFamily({
        familyId: 'F',
        totalSources: 1,
        eventsBuilt: 0,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        members: {},
        displayedProvided: true,
        error: 'reader blew up',
      }),
    ).toThrow(/error/i)
  })
})

describe('Phase 1 — buildGate1Artifact', () => {
  it('produces a valid artifact with per-family classification and real generatedAt', () => {
    const artifact = buildGate1Artifact({
      source: sourceReport(),
      approval: OWNER,
      now: () => NOW,
    })

    expect(artifact.artifactVersion).toBe(GATE1_ARTIFACT_VERSION)
    expect(artifact.report.gate).toBe('GATE_1_REACHED')
    expect(artifact.generatedAt).toBe(new Date(NOW).toISOString())
    expect(artifact.generatedAt).not.toBe('1970-01-01T00:00:00.000Z')
    expect(artifact.report.families.map((f) => f.familyId)).toEqual(['FAM_A', 'FAM_B'])
    expect(artifact.report.families.map((f) => f.classification)).toEqual(['exact', 'estimated'])
    expect(artifact.reportHash).toBe(hashGate1Report(artifact.report))
    expect(artifact.approvedBy).toBe(OWNER.approvedBy)
    expect(artifact.approvedAt).toBe(OWNER.approvedAt)
  })

  it('carries family-level accounting totals', () => {
    const artifact = buildGate1Artifact({ source: sourceReport(), approval: OWNER, now: () => NOW })
    const famA = artifact.report.families[0]
    expect(famA.accounting).toEqual({
      totalSources: 4,
      classified: 4,
      exact: 4,
      estimated: 0,
      malformed: 0,
      ambiguous: 0,
      skipped: 0,
    })
    expect(artifact.accounting.totalFamilies).toBe(2)
    expect(artifact.accounting.classified).toBe(6)
  })

  it('NEVER fabricates owner approval — missing approval throws', () => {
    expect(() =>
      buildGate1Artifact({
        source: sourceReport(),
        approval: undefined as unknown as OwnerApproval,
        now: () => NOW,
      }),
    ).toThrow(/owner approval/i)

    expect(() =>
      buildGate1Artifact({
        source: sourceReport(),
        approval: { approvedBy: '', approvedAt: OWNER.approvedAt } as OwnerApproval,
        now: () => NOW,
      }),
    ).toThrow(/approvedBy/i)
  })

  it('is deterministic — identical inputs produce byte-identical output', () => {
    const a = buildGate1Artifact({ source: sourceReport(), approval: OWNER, now: () => NOW })
    const b = buildGate1Artifact({ source: sourceReport(), approval: OWNER, now: () => NOW })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.reportHash).toBe(b.reportHash)
  })

  it('is order-insensitive on input family order (canonical sorted output)', () => {
    const reversed = sourceReport({
      families: [...sourceReport().families].reverse(),
    })
    const a = buildGate1Artifact({ source: sourceReport(), approval: OWNER, now: () => NOW })
    const b = buildGate1Artifact({ source: reversed, approval: OWNER, now: () => NOW })
    expect(b.reportHash).toBe(a.reportHash)
  })

  it('FAILS CLOSED when the source report is not GATE_1_REACHED', () => {
    expect(() =>
      buildGate1Artifact({
        source: sourceReport({ gate: 'DRAFT' as Gate1SourceReport['gate'] }),
        approval: OWNER,
        now: () => NOW,
      }),
    ).toThrow(/GATE_1_REACHED/)
  })

  it('FAILS CLOSED when any family is malformed/ambiguous', () => {
    const bad = sourceReport({
      families: [
        {
          familyId: 'FAM_A',
          totalSources: 1,
          eventsBuilt: 0,
          counts: { exact: 0, estimated: 0, malformed: 1, ambiguous: 0, skipped: 0 },
          members: {},
          displayedProvided: true,
        },
      ],
    })
    expect(() => buildGate1Artifact({ source: bad, approval: OWNER, now: () => NOW })).toThrow(
      Gate1EvidenceError,
    )
  })

  it('FAILS CLOSED on duplicate family ids', () => {
    const dup = sourceReport({
      families: [sourceReport().families[0], sourceReport().families[0]],
    })
    expect(() => buildGate1Artifact({ source: dup, approval: OWNER, now: () => NOW })).toThrow(
      /duplicate/i,
    )
  })
})

describe('Phase 1 — validateGate1Artifact (consumer fail-closed contract)', () => {
  const artifact = () => buildGate1Artifact({ source: sourceReport(), approval: OWNER, now: () => NOW })

  it('accepts a valid, fresh artifact for a classified family', () => {
    const r = validateGate1Artifact(artifact(), {
      familyId: 'FAM_A',
      now: () => NOW + 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    expect(r.valid).toBe(true)
    expect(r.classification).toBe('exact')
  })

  it('rejects a family missing from the artifact', () => {
    const r = validateGate1Artifact(artifact(), {
      familyId: 'FAM_ZZZ',
      now: () => NOW + 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/not present/i)
  })

  it('rejects a family present but unclassified', () => {
    const a = artifact()
    const tampered = {
      ...a,
      report: {
        ...a.report,
        families: a.report.families.map((f) =>
          f.familyId === 'FAM_A' ? { ...f, classification: '' } : f,
        ),
      },
    }
    const r = validateGate1Artifact(tampered as typeof a, {
      familyId: 'FAM_A',
      now: () => NOW + 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
      skipHashCheck: true,
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/classif/i)
  })

  it('rejects a STALE artifact', () => {
    const r = validateGate1Artifact(artifact(), {
      familyId: 'FAM_A',
      now: () => NOW + 8 * 24 * 60 * 60 * 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/stale/i)
  })

  it('rejects a HASH MISMATCH (tampered report)', () => {
    const a = artifact()
    const tampered = {
      ...a,
      report: { ...a.report, totalSources: a.report.totalSources + 1 },
    }
    const r = validateGate1Artifact(tampered as typeof a, {
      familyId: 'FAM_A',
      now: () => NOW + 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/hash/i)
  })

  it('rejects a MISSING OWNER APPROVAL', () => {
    const a = artifact()
    const stripped = { ...a, approvedBy: '' }
    const r = validateGate1Artifact(stripped as typeof a, {
      familyId: 'FAM_A',
      now: () => NOW + 1000,
      maxAgeMs: 24 * 60 * 60 * 1000,
      skipHashCheck: true,
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/approval/i)
  })

  it('rejects an artifact whose approval predates nothing (future approval)', () => {
    const a = artifact()
    const r = validateGate1Artifact(a, {
      familyId: 'FAM_A',
      now: () => Date.parse('2020-01-01T00:00:00.000Z'),
      maxAgeMs: 24 * 60 * 60 * 1000,
    })
    expect(r.valid).toBe(false)
  })
})
