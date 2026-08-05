/**
 * Gamification V4 — deterministic event id derivation tests (Task 1.2).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * See docs/gamification-v4-design.md §2.1 and plan Task 1.2.
 */

import { describe, expect, it } from 'vitest'
import {
  eventIdFor,
  MIGRATION_BASELINE_SOURCE_ID,
  reversalEventId,
} from './ids'

describe('eventIdFor', () => {
  it('derives a deterministic id from its four inputs', () => {
    const a = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'task-1#2026-01-05')
    const b = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'task-1#2026-01-05')
    expect(a).toBe(b)
    expect(a).toBe('fam1::mem1::TASK_APPROVED::task-1#2026-01-05')
  })

  it('produces different ids for different families', () => {
    const a = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    const b = eventIdFor('fam2', 'mem1', 'TASK_APPROVED', 'src-1')
    expect(a).not.toBe(b)
  })

  it('produces different ids for different members', () => {
    const a = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    const b = eventIdFor('fam1', 'mem2', 'TASK_APPROVED', 'src-1')
    expect(a).not.toBe(b)
  })

  it('produces different ids for different event types', () => {
    const a = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    const b = eventIdFor('fam1', 'mem1', 'BEHAVIOUR_POSITIVE', 'src-1')
    expect(a).not.toBe(b)
  })

  it('produces different ids for different source ids', () => {
    const a = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    const b = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-2')
    expect(a).not.toBe(b)
  })

  it('uses BASELINE as the migration baseline source id', () => {
    const id = eventIdFor('fam1', 'mem1', 'MIGRATION_BASELINE', MIGRATION_BASELINE_SOURCE_ID)
    expect(id).toBe('fam1::mem1::MIGRATION_BASELINE::BASELINE')
    expect(MIGRATION_BASELINE_SOURCE_ID).toBe('BASELINE')
  })
})

describe('reversalEventId', () => {
  it('appends ::REV deterministically to the original id', () => {
    const original = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    expect(reversalEventId(original, 'REV')).toBe(`${original}::REV`)
  })

  it('appends ::REFUND deterministically to the original id', () => {
    const original = eventIdFor('fam1', 'mem1', 'REWARD_REDEEMED', 'src-1')
    expect(reversalEventId(original, 'REFUND')).toBe(`${original}::REFUND`)
  })

  it('is idempotent for the same original and kind', () => {
    const original = eventIdFor('fam1', 'mem1', 'TASK_APPROVED', 'src-1')
    expect(reversalEventId(original, 'REV')).toBe(reversalEventId(original, 'REV'))
  })

  it('distinguishes REV from REFUND for the same original', () => {
    const original = eventIdFor('fam1', 'mem1', 'REWARD_REDEEMED', 'src-1')
    expect(reversalEventId(original, 'REV')).not.toBe(reversalEventId(original, 'REFUND'))
  })
})
