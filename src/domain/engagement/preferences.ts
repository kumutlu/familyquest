/**
 * Family engagement preferences (V1).
 *
 * Separate from `ExperiencePreferences` because the two model different
 * concerns:
 *   - `ExperiencePreferences` toggles CELEBRATIONS (Neon Week, Christmas,
 *     Ramadan, …). Adding a new celebration is a content decision and
 *     follows the existing opt-in pattern.
 *   - `EngagementPreferences` toggles OPPORTUNITY MECHANICS (e.g. whether
 *     Surges can be emitted for this family). Adding a new mechanic is a
 *     product decision and must NOT be conflated with content opt-ins.
 *
 * The Firestore Rules validator (`isValidEngagementPreferences`) enforces
 * the closed-key shape on write so a malicious owner cannot stash
 * arbitrary fields. New keys must be added explicitly here AND in the
 * Rules validator.
 *
 * Default is `surgeHours: true` so opt-out is always an explicit action.
 */
export interface EngagementPreferences {
  /** Master opt-in for Surge bonus opportunities. Defaults to true. */
  readonly surgeHours: boolean
}

export const DEFAULT_ENGAGEMENT_PREFERENCES: EngagementPreferences = Object.freeze({
  surgeHours: true,
}) as EngagementPreferences

/** Build a defensively-defaulted preferences object. A missing/partial
 *  Firestore field never causes a feature to silently disable. */
export function normaliseEngagementPreferences(
  raw: Partial<EngagementPreferences> | null | undefined,
): EngagementPreferences {
  return Object.freeze({
    surgeHours:
      raw?.surgeHours !== undefined
        ? raw.surgeHours === true
        : DEFAULT_ENGAGEMENT_PREFERENCES.surgeHours,
  }) as EngagementPreferences
}