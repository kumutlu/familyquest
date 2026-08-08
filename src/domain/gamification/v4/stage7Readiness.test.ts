/**
 * Gamification V4 — Stage 7 readiness evaluation tests (TDD-first, pure).
 *
 * No firebase import; runs under `vitest run --dir src` with no emulator.
 */

import { describe, expect, it } from 'vitest'

import {
  allGatesPassed,
  evaluateStage7Readiness,
  gateStatus,
  type Stage7ReadinessInput,
} from './stage7Readiness'

function failing(gate: 'gate1' | 'gate2' | 'stage6'): Stage7ReadinessInput {
  const base = allGatesPassed()
  return { ...base, [gate]: gateStatus(false, `${gate} blocked: reason`) }
}

describe('Stage 7 readiness — fail closed', () => {
  it('is ready only when all three gates pass', () => {
    const r = evaluateStage7Readiness(allGatesPassed())
    expect(r.ready).toBe(true)
    expect(r.failedGates).toEqual([])
    expect(r.reasons).toEqual([])
  })

  it('blocks when Gate 1 (replay report) is not approved', () => {
    const r = evaluateStage7Readiness(failing('gate1'))
    expect(r.ready).toBe(false)
    expect(r.failedGates).toEqual(['gate1'])
    expect(r.reasons[0]).toContain('gate1')
  })

  it('blocks when Gate 2 (migration marker / wallet hash) fails', () => {
    const r = evaluateStage7Readiness(failing('gate2'))
    expect(r.ready).toBe(false)
    expect(r.failedGates).toEqual(['gate2'])
  })

  it('blocks when Stage 6 (verifyPreCutover) fails', () => {
    const r = evaluateStage7Readiness(failing('stage6'))
    expect(r.ready).toBe(false)
    expect(r.failedGates).toEqual(['stage6'])
  })

  it('blocks when MULTIPLE gates fail, reporting every reason', () => {
    const input: Stage7ReadinessInput = {
      gate1: gateStatus(false, 'replay not approved'),
      gate2: gateStatus(false, 'wallet hash mismatch'),
      stage6: gateStatus(true, 'ok'),
    }
    const r = evaluateStage7Readiness(input)
    expect(r.ready).toBe(false)
    expect(r.failedGates).toEqual(['gate1', 'gate2'])
    expect(r.reasons).toHaveLength(2)
    expect(r.reasons.join(' | ')).toContain('replay not approved')
    expect(r.reasons.join(' | ')).toContain('wallet hash mismatch')
  })

  it('is deterministic: identical input => identical verdict', () => {
    const input = failing('stage6')
    expect(JSON.stringify(evaluateStage7Readiness(input))).toBe(
      JSON.stringify(evaluateStage7Readiness(input)),
    )
  })

  it('gateStatus helper builds the expected shape', () => {
    expect(gateStatus(true, 'ok')).toEqual({ passed: true, detail: 'ok' })
    expect(gateStatus(false, 'nope')).toEqual({ passed: false, detail: 'nope' })
  })
})
