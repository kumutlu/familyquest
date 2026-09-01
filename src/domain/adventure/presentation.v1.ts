/**
 * `resolveDailyAdventurePresentation` — pure presentation resolver for the
 * Child Home "Today's Adventure" surface.
 *
 * Architectural law
 * -----------------
 *   1. Engagement Engine creates opportunities.
 *   2. Gamification Engine awards value.
 *   3. This resolver ONLY decides which card to surface. It is
 *      PRESENTATION-ONLY. It never determines economic eligibility, never
 *      inspects authoritative reward values, never suggests a tier
 *      transition that the host has not already proven.
 *
 * Precedence (top wins, exactly one primary slot per call)
 * --------------------------------------------------------
 *   1. `surge`              — an active Surge with eligible tasks
 *   2. `mystery_ready`      — a Mystery Drop that is unlocked and ready to open
 *   3. `comeback`           — an active Comeback Mission
 *   4. `mystery_available`  — a Mystery Drop that is locked / progressing
 *   5. `seasonal`           — a seasonal-only state (no other special opportunity,
 *                             but a recognised seasonal event is live)
 *   6. `normal`             — a calm fallback (always the lowest priority)
 *
 * The resolver is intentionally cheap and synchronous. It is fed a
 * context the host has already assembled from authoritative sources.
 *
 * Important semantics
 * -------------------
 *   - `mystery_ready` beats `comeback`. A legitimately unlocked Mystery
 *     Drop is a special moment; it must not be shadowed by a routine
 *     return-1d welcome card.
 *   - `mystery_available` (LOCKED / progress) is materially different
 *     from `mystery_ready` and is explicitly demoted below Comeback.
 *   - `normal` is a CALM fallback. It is what the surface shows on days
 *     when no special opportunity exists. It is never silently dropped.
 *   - `seasonal` is a presentation accent for important seasonal state
 *     (Christmas / Halloween / Ramadan-Eid / Neon weekly). It only
 *     surfaces when no special opportunity outranks it.
 *   - The resolver NEVER invents XP amounts, item ids, or reward
 *     shapes. The host must source those from authoritative state.
 */

// --------------------------------------------------------------------
// Resolver context
// --------------------------------------------------------------------

/**
 * Canonical input to the presentation resolver. Each field is sourced
 * from an authoritative upstream resolver or store; nothing is
 * recomputed here.
 */
export interface DailyAdventureContext {
  /** Active Surge from the engagement resolver; null when none. */
  readonly surge: DailyAdventureSurge | null
  /** Mystery Drop from the engagement resolver; null when none. */
  readonly mysteryDrop: DailyAdventureMysteryDrop | null
  /** Comeback Mission from the comeback resolver; null when none. */
  readonly comeback: DailyAdventureComeback | null
  /**
   * Whether a recognised seasonal or weekly event is currently live.
   * Sourced from the experience theme resolver.
   */
  readonly seasonalActive: boolean
  /**
   * Whether the underlying state has been resolved by the host.
   * `false` means "we are still loading authoritative data" — the
   * surface must not flash special opportunities during this window.
   */
  readonly resolved: boolean
}

export interface DailyAdventureSurge {
  readonly surgeId: string
  /** The number of eligible tasks the resolver surfaced for this surge. */
  readonly eligibleTaskCount: number
}

export interface DailyAdventureMysteryDrop {
  readonly id: string
  readonly rarity: 'common' | 'rare' | 'epic'
  /**
   * `true` ⇢ the drop is fully unlocked and the child may tap OPEN.
   * `false` ⇢ the drop is locked or progressing (different visuals).
   */
  readonly isRevealReady: boolean
}

export interface DailyAdventureComeback {
  readonly tier: 'return_1d' | 'return_3d' | 'return_7d' | 'none'
  readonly inactivityDays: number
}

// --------------------------------------------------------------------
// Resolver output
// --------------------------------------------------------------------

export type DailyAdventurePresentationKind =
  | 'surge'
  | 'mystery_ready'
  | 'comeback'
  | 'mystery_available'
  | 'seasonal'
  | 'normal'
  | 'loading'

export interface DailyAdventurePresentation {
  readonly kind: DailyAdventurePresentationKind
  /**
   * Hint surfaced from the resolver. The host already knows the input
   * shape; this field is the resolver's verdict and is the SINGLE field
   * the UI multiplexes on.
   */
  readonly reason:
    | 'active_surge'
    | 'mystery_unlocked'
    | 'comeback_active'
    | 'mystery_progressing'
    | 'seasonal_only'
    | 'no_special_opportunity'
    | 'state_unresolved'
}

// --------------------------------------------------------------------
// Resolver
// --------------------------------------------------------------------

/**
 * Pure presentation resolver. Same inputs ⇒ same output. No clock, no
 * Firestore, no React. The host calls this synchronously from its render
 * path and renders the result.
 *
 * Returns `kind: 'loading'` whenever `context.resolved === false` so the
 * surface can suppress any of the special opportunities until the host
 * has authoritative data. This is the safety guard against
 * "+50 XP Comeback" flashing briefly and then being withdrawn.
 */
export function resolveDailyAdventurePresentation(
  context: DailyAdventureContext,
): DailyAdventurePresentation {
  if (!context.resolved) {
    return { kind: 'loading', reason: 'state_unresolved' }
  }

  // 1) Surge is always the loudest card.
  if (context.surge && context.surge.eligibleTaskCount > 0) {
    return { kind: 'surge', reason: 'active_surge' }
  }

  // 2) A genuinely unlocked Mystery Drop is special once. It outranks
  //    Comeback so a routine return-1d welcome never shadows it.
  if (context.mysteryDrop && context.mysteryDrop.isRevealReady) {
    return { kind: 'mystery_ready', reason: 'mystery_unlocked' }
  }

  // 3) Active Comeback outranks a still-progressing Mystery Drop — the
  //    Comeback is a calmer signal, so a locked Mystery Drop should not
  //    eclipse it.
  if (context.comeback && context.comeback.tier !== 'none') {
    return { kind: 'comeback', reason: 'comeback_active' }
  }

  // 4) A Mystery Drop that is locked / progressing but not yet unlocked
  //    is its own kind. Materially different from `mystery_ready`.
  if (context.mysteryDrop && !context.mysteryDrop.isRevealReady) {
    return { kind: 'mystery_available', reason: 'mystery_progressing' }
  }

  // 5) Important seasonal state. Only surfaces when no special
  //    opportunity outranks it.
  if (context.seasonalActive) {
    return { kind: 'seasonal', reason: 'seasonal_only' }
  }

  // 6) Calm fallback. Always the lowest priority. Always reachable when
  //    `resolved === true`.
  return { kind: 'normal', reason: 'no_special_opportunity' }
}

// --------------------------------------------------------------------
// Snapshot helpers (pure)
// --------------------------------------------------------------------

/**
 * Build an unresolved / loading context. The host uses this whenever any
 * authoritative upstream (child profile, family preferences, engagement
 * resolver, comeback resolver) is not yet resolved.
 */
export function unresolvedDailyAdventureContext(): DailyAdventureContext {
  return {
    surge: null,
    mysteryDrop: null,
    comeback: null,
    seasonalActive: false,
    resolved: false,
  }
}