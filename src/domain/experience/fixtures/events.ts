/**
 * Curated event catalog for the FamilyQuest / Queki engagement engine.
 *
 * Each event is *content*, not code. The resolver accepts arbitrary event
 * ids so families can schedule future celebrations (Diwali, Hanukkah, Lunar
 * New Year, Summer Adventure, New Year…) without a schema redesign.
 *
 * Engagement rule: events are *opportunities*. They never mint points or
 * XP. Families can still create their own task definitions for any
 * celebration activity.
 */

import type { EventDefinition } from '../types';

/**
 * Convenience: a fully-active event for a given window.
 *
 * Status is always `active` for fixtures that the resolver is allowed to
 * match — `draft`/`scheduled`/`ended` are correctly filtered.
 */
function active(
  id: string,
  name: string,
  type: EventDefinition['type'],
  startsAt: number,
  endsAt: number,
  rest: Partial<EventDefinition> = {},
): EventDefinition {
  return Object.freeze({
    id,
    type,
    name,
    startsAt,
    endsAt,
    status: 'active',
    ...rest,
  }) as EventDefinition;
}

/**
 * Christmas 2026 window. Theme: Festive Lights. Optional collectible set.
 */
export const CHRISTMAS_EVENT_2026: EventDefinition = Object.freeze(
  active(
    'event.christmas.2026',
    'Christmas 2026',
    'seasonal',
    Date.UTC(2026, 11, 1, 0, 0, 0),
    Date.UTC(2026, 11, 31, 23, 59, 59),
    {
      themeId: 'theme.christmas',
      collectibles: Object.freeze(['theme.christmas.2026', 'avatar.frame.festive', 'badge.kindness-2026']),
      eligibility: Object.freeze({ preferenceKey: 'christmas' }) as EventDefinition['eligibility'],
    },
  ),
) as EventDefinition;

/**
 * Halloween 2026. Friendly, child-safe visuals.
 */
export const HALLOWEEN_EVENT_2026: EventDefinition = Object.freeze(
  active(
    'event.halloween.2026',
    'Halloween 2026',
    'seasonal',
    Date.UTC(2026, 9, 25, 0, 0, 0),
    Date.UTC(2026, 9, 31, 23, 59, 59),
    {
      themeId: 'theme.halloween',
      collectibles: Object.freeze(['theme.halloween.2026', 'avatar.frame.pumpkin']),
      eligibility: Object.freeze({ preferenceKey: 'halloween' }) as EventDefinition['eligibility'],
    },
  ),
) as EventDefinition;

/**
 * Ramadan 2026. Neutral, non-religious visuals (lanterns / stars / moon).
 * No automatic religious-worship rewards. Families may opt in; the engine
 * simply paints the theme.
 */
export const RAMADAN_EVENT_2026: EventDefinition = Object.freeze(
  active(
    'event.ramadan.2026',
    'Ramadan 2026',
    'seasonal',
    Date.UTC(2026, 1, 17, 0, 0, 0),
    Date.UTC(2026, 2, 18, 23, 59, 59),
    {
      themeId: 'theme.ramadan',
      collectibles: Object.freeze(['theme.ramadan.2026', 'avatar.frame.lantern', 'badge.kindness-ramadan-2026']),
      eligibility: Object.freeze({ preferenceKey: 'ramadan' }) as EventDefinition['eligibility'],
    },
  ),
) as EventDefinition;

/**
 * Eid 2026. Celebratory family visuals.
 */
export const EID_EVENT_2026: EventDefinition = Object.freeze(
  active(
    'event.eid.2026',
    'Eid 2026',
    'seasonal',
    Date.UTC(2026, 2, 20, 0, 0, 0),
    Date.UTC(2026, 2, 22, 23, 59, 59),
    {
      themeId: 'theme.eid',
      collectibles: Object.freeze(['theme.eid.2026', 'avatar.frame.festive-emerald']),
      eligibility: Object.freeze({ preferenceKey: 'eid' }) as EventDefinition['eligibility'],
    },
  ),
) as EventDefinition;

/**
 * Neon Week. Pure visual weekly accent. Always eligible when the family
 * has `weeklyThemes` enabled.
 */
export const NEON_WEEK_EVENT: EventDefinition = Object.freeze(
  active(
    'event.weekly.neon',
    'Neon Week',
    'weekly_theme',
    Date.UTC(2026, 6, 1, 0, 0, 0),
    Date.UTC(2026, 6, 7, 23, 59, 59),
    {
      themeId: 'theme.weekly.neon',
      collectibles: Object.freeze(['theme.weekly.neon']),
    },
  ),
) as EventDefinition;

/**
 * The full event catalog. Pure data — no behaviour. Adding a future
 * celebration (Diwali, Hanukkah, Lunar New Year, New Year, Summer
 * Adventure…) is a one-line addition here.
 */
export const EVENT_CATALOG: readonly EventDefinition[] = Object.freeze([
  CHRISTMAS_EVENT_2026,
  HALLOWEEN_EVENT_2026,
  RAMADAN_EVENT_2026,
  EID_EVENT_2026,
  NEON_WEEK_EVENT,
]);

/** Look up an event by id. Returns `undefined` when unknown. */
export function getEventById(id: string | undefined | null): EventDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return EVENT_CATALOG.find((event) => event.id === id);
}