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
