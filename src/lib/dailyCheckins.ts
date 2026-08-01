export const DAILY_CHECKIN_CATALOG_VERSION = 1 as const;
export const DAILY_CHECKIN_CATALOG = [
  { id: 'cheetah', emoji: '🐆', nameKey: 'animals.cheetah.name', feelingKey: 'animals.cheetah.feeling', ariaKey: 'animals.cheetah.aria', catalogVersion: 1 },
  { id: 'lion', emoji: '🦁', nameKey: 'animals.lion.name', feelingKey: 'animals.lion.feeling', ariaKey: 'animals.lion.aria', catalogVersion: 1 },
  { id: 'monkey', emoji: '🐒', nameKey: 'animals.monkey.name', feelingKey: 'animals.monkey.feeling', ariaKey: 'animals.monkey.aria', catalogVersion: 1 },
  { id: 'owl', emoji: '🦉', nameKey: 'animals.owl.name', feelingKey: 'animals.owl.feeling', ariaKey: 'animals.owl.aria', catalogVersion: 1 },
  { id: 'fox', emoji: '🦊', nameKey: 'animals.fox.name', feelingKey: 'animals.fox.feeling', ariaKey: 'animals.fox.aria', catalogVersion: 1 },
  { id: 'panda', emoji: '🐼', nameKey: 'animals.panda.name', feelingKey: 'animals.panda.feeling', ariaKey: 'animals.panda.aria', catalogVersion: 1 },
  { id: 'turtle', emoji: '🐢', nameKey: 'animals.turtle.name', feelingKey: 'animals.turtle.feeling', ariaKey: 'animals.turtle.aria', catalogVersion: 1 },
  { id: 'sloth', emoji: '🦥', nameKey: 'animals.sloth.name', feelingKey: 'animals.sloth.feeling', ariaKey: 'animals.sloth.aria', catalogVersion: 1 },
] as const;

export type DailyCheckinAnimal = typeof DAILY_CHECKIN_CATALOG[number]['id'];
export type DailyCheckinRecord = {
  id: string; familyId: string; userId: string; localDate: string;
  animal: DailyCheckinAnimal; catalogVersion: 1; createdAt: unknown; updatedAt: unknown;
};
export type DailyCheckinSkip = {
  id: string; familyId: string; userId: string; localDate: string; createdAt: unknown;
};

export const resolvedDailyCheckinSettings = (value?: Partial<{ childrenEnabled: boolean; historyVisibleToParents: boolean }>) => ({
  childrenEnabled: value?.childrenEnabled ?? true,
  historyVisibleToParents: value?.historyVisibleToParents ?? true,
});
export const resolvedParentParticipation = (value?: Partial<{ parentParticipationEnabled: boolean }>) =>
  value?.parentParticipationEnabled ?? false;

const validTimezone = (value?: string) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0);
    return value!;
  } catch {
    return 'Europe/London';
  }
};

export const familyDayKey = (date: Date, timezone?: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const dailyCheckinDocumentId = (userId: string, localDate: string) => `${userId}_${localDate}`;

export type DailyCheckinEligibility = 'loading' | 'eligible' | 'resolved-ineligible';
export type EligibilityInput = {
  resolved: boolean;
  role?: 'child' | 'parent';
  childrenEnabled?: boolean;
  parentParticipationEnabled?: boolean;
  checkinExists?: boolean;
  skipExists?: boolean;
};

export function resolveDailyCheckinEligibility(input: EligibilityInput): DailyCheckinEligibility {
  if (!input.resolved) return 'loading';
  const participating = input.role === 'child' ? input.childrenEnabled : input.parentParticipationEnabled;
  return participating && !input.checkinExists && !input.skipExists ? 'eligible' : 'resolved-ineligible';
}

const gregorianDay = (dayKey: string) => {
  const [year, month, day] = dayKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

export function summarizeDailyCheckins(
  records: readonly DailyCheckinRecord[], today: string,
): Array<{ userId: string; animal: DailyCheckinAnimal; count: number }> {
  const earliestDay = gregorianDay(today) - 6;
  const summary = new Map<string, { userId: string; animal: DailyCheckinAnimal; count: number }>();

  for (const record of records) {
    const day = gregorianDay(record.localDate);
    if (day < earliestDay || day > earliestDay + 6) continue;
    const key = `${record.userId}:${record.animal}`;
    const existing = summary.get(key);
    if (existing) existing.count += 1;
    else summary.set(key, { userId: record.userId, animal: record.animal, count: 1 });
  }

  return [...summary.values()];
}
