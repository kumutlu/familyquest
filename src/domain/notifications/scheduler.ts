/**
 * Smart Notifications V1 — deterministic evaluation scheduler.
 *
 * Pure helper. Returns the slot (morning / midday / evening) for a
 * given local time. Used by the server-side scheduled evaluator and
 * by tests to pin the slot boundary behaviour.
 *
 * Boundaries are INCLUSIVE on start and EXCLUSIVE on end, matching
 * the spec §22 windows.
 */

import { EVALUATION_SLOTS, type EvaluationSlot } from './types'
import { localTimeOfDay } from './types'

function toMinutes(t: { hour: number; minute: number }): number {
  return t.hour * 60 + t.minute
}

export interface SlotResolution {
  readonly slot: EvaluationSlot
  /** True iff `now` falls inside the slot window. */
  readonly inWindow: boolean
}

export function resolveEvaluationSlot(now: number, timezone: string): SlotResolution {
  const t = toMinutes(localTimeOfDay(now, timezone))
  for (const slot of EVALUATION_SLOTS) {
    const start = slot.startHour * 60 + slot.startMinute
    const end = slot.endHour * 60 + slot.endMinute
    if (t >= start && t < end) {
      return { slot: slot.name, inWindow: true }
    }
  }
  // Outside any slot — return the nearest preceding slot name so
  // callers can still attribute a debug log line.
  if (t < toMinutes({ hour: EVALUATION_SLOTS[0].startHour, minute: EVALUATION_SLOTS[0].startMinute })) {
    return { slot: 'morning', inWindow: false }
  }
  return { slot: 'evening', inWindow: false }
}