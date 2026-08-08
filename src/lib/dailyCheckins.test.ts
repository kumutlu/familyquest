import { describe, expect, it } from 'vitest';
import {
  DAILY_CHECKIN_CATALOG,
  type DailyCheckinRecord,
  dailyCheckinDocumentId,
  familyDayKey,
  resolveDailyCheckinEligibility,
  resolvedDailyCheckinSettings,
  resolvedParentParticipation,
  summarizeDailyCheckins,
} from './dailyCheckins';

describe('daily check-in domain', () => {
  it('defines the immutable V1 animal catalog', () => {
    expect(DAILY_CHECKIN_CATALOG.map(item => item.id)).toEqual([
      'cheetah', 'lion', 'monkey', 'owl', 'fox', 'panda', 'turtle', 'sloth',
    ]);
    expect(DAILY_CHECKIN_CATALOG.every(item => item.catalogVersion === 1 && item.emoji)).toBe(true);
  });

  it('uses safe legacy defaults', () => {
    expect(resolvedDailyCheckinSettings(undefined)).toEqual({
      childrenEnabled: true,
      historyVisibleToParents: true,
    });
    expect(resolvedParentParticipation(undefined)).toBe(false);
  });

  it('builds the family-local deterministic identity across DST', () => {
    const instant = new Date('2026-03-29T00:30:00Z');
    expect(familyDayKey(instant, 'Europe/London')).toBe('2026-03-29');
    expect(dailyCheckinDocumentId('child-1', '2026-03-29')).toBe('child-1_2026-03-29');
  });

  it.each([
    ['spring transition day before local midnight', '2026-03-28T23:59:59.999Z', '2026-03-28'],
    ['spring transition day after local midnight', '2026-03-29T00:00:00.000Z', '2026-03-29'],
    ['first post-spring midnight before rollover', '2026-03-29T22:59:59.999Z', '2026-03-29'],
    ['first post-spring midnight after rollover', '2026-03-29T23:00:00.000Z', '2026-03-30'],
    ['autumn transition day before local midnight', '2026-10-24T22:59:59.999Z', '2026-10-24'],
    ['autumn transition day after local midnight', '2026-10-24T23:00:00.000Z', '2026-10-25'],
    ['first post-autumn midnight before rollover', '2026-10-25T23:59:59.999Z', '2026-10-25'],
    ['first post-autumn midnight after rollover', '2026-10-26T00:00:00.000Z', '2026-10-26'],
  ])('uses the literal London family day at %s', (_caseName, instant, expectedDay) => {
    expect(familyDayKey(new Date(instant), 'Europe/London')).toBe(expectedDay);
  });

  it('falls back to Europe/London for invalid legacy timezone data', () => {
    expect(familyDayKey(new Date('2026-08-01T23:30:00Z'), 'invalid')).toBe('2026-08-02');
  });

  it('uses Europe/London when legacy timezone data is absent', () => {
    expect(familyDayKey(new Date('2026-08-01T00:30:00Z'), undefined)).toBe('2026-08-01');
  });

  it.each([
    [{ resolved: false }, 'loading'],
    [{ resolved: true, role: 'child', childrenEnabled: true, checkinExists: false, skipExists: false }, 'eligible'],
    [{ resolved: true, role: 'parent', parentParticipationEnabled: false, checkinExists: false, skipExists: false }, 'resolved-ineligible'],
    [{ resolved: true, role: 'child', childrenEnabled: true, checkinExists: true, skipExists: false }, 'resolved-ineligible'],
  ])('resolves eligibility without flashing', (input, expected) => {
    expect(resolveDailyCheckinEligibility(input as any)).toBe(expected);
  });

  it('counts only explicit selections inside seven family days', () => {
    const records = [
      { userId: 'alex', localDate: '2026-08-01', animal: 'sloth' },
      { userId: 'alex', localDate: '2026-07-30', animal: 'sloth' },
      { userId: 'alex', localDate: '2026-07-25', animal: 'lion' },
    ] as DailyCheckinRecord[];
    expect(summarizeDailyCheckins(records, '2026-08-01')).toEqual([
      { userId: 'alex', animal: 'sloth', count: 2 },
    ]);
  });
});
