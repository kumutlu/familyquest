/**
 * The single deterministic Mascot Presentation resolver.
 *
 * Precedence (top wins):
 *
 *   LEVEL UP / major achievement
 *      ↓
 *   ALL QUESTS COMPLETED
 *      ↓
 *   WELCOME BACK (comeback signal from the engine layer)
 *      ↓
 *   LONG INACTIVITY  (>= 3 days, theatrical grumpy — never guilt-heavy)
 *      ↓
 *   SHORT INACTIVITY (>= 1 day, suspicious — playful)
 *      ↓
 *   STREAK AT RISK   (active streak, but quests not done today)
 *      ↓
 *   ALL QUESTS DONE, NO STREAK (small "done for today" nudge)
 *      ↓
 *   NEW USER         (first-meeting presentation)
 *      ↓
 *   SEASONAL         (theme is active → forward its costume)
 *      ↓
 *   TIME OF DAY      (morning → sleepy/friendly, late → sleepy)
 *      ↓
 *   FRIENDLY DEFAULT (always safe)
 *
 * The resolver is the ONLY place this precedence is encoded. Components
 * consume the resolved presentation; they NEVER reimplement the rules.
 *
 * Safety contract:
 *   - All inputs are optional and defensively coerced to safe defaults.
 *   - Bad timestamps (NaN, negative, future) do not crash — they fall
 *     back to the default priority layer.
 *   - Missing `displayName` does not break interpolation.
 *   - Returning users are WELCOMED, not punished — grumpy is theatrical.
 *   - No write side effects. Pure function of inputs.
 */

import {
  DEFAULT_MASCOT_PRESENTATION,
  MASCOT_THRESHOLDS,
  type MascotAnimationId,
  type MascotContext,
  type MascotExpression,
  type MascotMood,
  type MascotPresentation,
  type ResolveMascotPresentationInput,
} from './types';

/* -------------------------------------------------------------------------- */
/* Input hardening                                                            */
/* -------------------------------------------------------------------------- */

function safeNonNegativeInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return 0;
  if (input < 0) return 0;
  return Math.floor(input);
}

function safeLocalHour(now: unknown): number {
  if (typeof now !== 'number' || !Number.isFinite(now)) return 12;
  const d = new Date(now);
  const h = d.getHours();
  return Number.isFinite(h) ? h : 12;
}

function daysBetween(later: number, earlier: number): number {
  if (
    typeof later !== 'number' ||
    typeof earlier !== 'number' ||
    !Number.isFinite(later) ||
    !Number.isFinite(earlier)
  ) {
    return 0;
  }
  const delta = later - earlier;
  if (delta <= 0) return 0;
  return Math.floor(delta / MASCOT_THRESHOLDS.MS_PER_DAY);
}

/* -------------------------------------------------------------------------- */
/* Presentation builders                                                     */
/* -------------------------------------------------------------------------- */

function presentation(input: {
  mood: MascotMood;
  expression: MascotExpression;
  messageKey: string;
  animationId?: MascotAnimationId;
  costumeId?: string;
  priorityTag: MascotPresentation['priorityTag'];
}): MascotPresentation {
  return Object.freeze({
    mood: input.mood,
    expression: input.expression,
    messageKey: input.messageKey,
    ...(input.animationId ? { animationId: input.animationId } : {}),
    ...(input.costumeId ? { costumeId: input.costumeId } : {}),
    priorityTag: input.priorityTag,
  }) as MascotPresentation;
}

/* -------------------------------------------------------------------------- */
/* Resolver                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the mascot presentation from a read-only context.
 *
 * Pure function. Same inputs ⇒ same outputs. Safe to call from anywhere.
 *
 * @param input The composed context + resolved costume id.
 * @returns A frozen {@link MascotPresentation}.
 */
export function resolveMascotPresentation(
  input: ResolveMascotPresentationInput,
): MascotPresentation {
  const { context, resolvedCostumeId } = input;

  // Defence-in-depth: if the caller passes something malformed, we still
  // return a usable presentation.
  if (!context || typeof context !== 'object') {
    return presentation({
      mood: DEFAULT_MASCOT_PRESENTATION.mood,
      expression: DEFAULT_MASCOT_PRESENTATION.expression,
      messageKey: DEFAULT_MASCOT_PRESENTATION.messageKey,
      animationId: DEFAULT_MASCOT_PRESENTATION.animationId as MascotAnimationId,
      priorityTag: 'default',
    });
  }

  const now = context.now;
  const safeNow = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();

  const costumeId =
    typeof resolvedCostumeId === 'string' && resolvedCostumeId.length > 0
      ? resolvedCostumeId
      : context.event?.mascotCostumeId;

  // --- 1) Level up / major achievement -----------------------------------
  if (context.progression?.levelUpJustOccurred === true) {
    return presentation({
      mood: 'celebrating',
      expression: 'sparkle_burst',
      animationId: 'anim.celebrate.jump',
      messageKey: 'mascot.celebrate.level_up',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'level-up',
    });
  }

  // --- 2) All quests completed -------------------------------------------
  const allQuestsDone = context.activity?.allQuestsCompleted === true;
  if (allQuestsDone) {
    return presentation({
      mood: 'proud',
      expression: 'big_smile',
      animationId: 'anim.proud.chest_puff',
      messageKey: 'mascot.celebrate.all_quests_done',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'all-quests-complete',
    });
  }

  // --- 3) Welcome back (explicit comeback signal) -------------------------
  if (context.state?.comebackJustOccurred === true) {
    return presentation({
      mood: 'welcome_back',
      expression: 'sparkle',
      animationId: 'anim.welcome.wave',
      messageKey: 'mascot.welcome_back.general',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'welcome-back',
    });
  }

  // --- 4 & 5) Inactivity ladder -------------------------------------------
  const lastActiveAt = context.activity?.lastActiveAt;
  if (typeof lastActiveAt === 'number' && Number.isFinite(lastActiveAt)) {
    const daysAway = daysBetween(safeNow, lastActiveAt);

    if (daysAway >= MASCOT_THRESHOLDS.LONG_INACTIVITY_DAYS) {
      // Theatrical / playful grumpy. Never guilt-heavy. Returning users
      // are welcomed on the NEXT visit; here the signal is "I noticed".
      return presentation({
        mood: 'grumpy',
        expression: 'frown',
        animationId: 'anim.suspicious.look_around',
        messageKey: 'mascot.inactivity.long',
        ...(costumeId ? { costumeId } : {}),
        priorityTag: 'long-inactivity',
      });
    }

    if (daysAway >= MASCOT_THRESHOLDS.SHORT_INACTIVITY_DAYS) {
      return presentation({
        mood: 'suspicious',
        expression: 'raised_eyebrow',
        animationId: 'anim.suspicious.look_around',
        messageKey: 'mascot.inactivity.short',
        ...(costumeId ? { costumeId } : {}),
        priorityTag: 'long-inactivity',
      });
    }
  }

  // --- 6) Streak at risk (active streak but no quest yet today) -----------
  const streak = safeNonNegativeInteger(context.activity?.currentStreak);
  const questsCompletedToday = safeNonNegativeInteger(
    context.activity?.questsCompletedToday,
  );
  const questsRemaining = safeNonNegativeInteger(context.activity?.questsRemaining);
  if (streak > 0 && questsCompletedToday === 0 && questsRemaining > 0) {
    return presentation({
      mood: 'excited',
      expression: 'wink',
      animationId: 'anim.talk.bounce',
      messageKey: 'mascot.streak.at_risk',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'streak-at-risk',
    });
  }

  // --- 7) New user / first-meeting presentation ---------------------------
  if (context.child?.isFirstMeeting === true) {
    return presentation({
      mood: 'curious',
      expression: 'wide_eyes',
      animationId: 'anim.curious.tilt',
      messageKey: 'mascot.first_meeting',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'new-user',
    });
  }

  // --- 7b) Surge ending soon — placed BELOW major achievements / streak
  //        (per the Surge V1 brief: "below major achievement / all-quests-
  //        complete priority") but ABOVE seasonal/time-of-day because the
  //        window is genuinely closing. ----
  if (context.engagement?.surgeEndingSoon === true) {
    return presentation({
      mood: 'shocked',
      expression: 'wide_eyes',
      animationId: 'anim.shocked.jump_back',
      messageKey: 'mascot.surge.ending_soon',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'surge-ending-soon',
    })
  }

  // --- 7c) Surge active — same level as a seasonal theme. The mascot never
  //        tells the child what a Surge IS — only that something exciting is
  //        happening. ----
  if (context.engagement?.activeSurge === true) {
    return presentation({
      mood: 'excited',
      expression: 'sparkle',
      animationId: 'anim.talk.bounce',
      messageKey: 'mascot.surge.active',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: 'surge-active',
    })
  }

    // --- 8) Seasonal theme is active → forward the costume on default ------
  const seasonalTag: MascotPresentation['priorityTag'] = costumeId
    ? 'seasonal'
    : 'default';

  // --- 9) Time of day ----------------------------------------------------
  const hour = safeLocalHour(safeNow);
  if (hour < MASCOT_THRESHOLDS.MORNING_CUTOFF_HOUR) {
    // Early-morning default: sleepy but welcoming.
    return presentation({
      mood: 'sleepy',
      expression: 'sleepy_eyes',
      animationId: 'anim.sleepy.yawn',
      messageKey: 'mascot.time.morning',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: seasonalTag,
    });
  }
  if (hour >= MASCOT_THRESHOLDS.EVENING_CUTOFF_HOUR) {
    return presentation({
      mood: 'sleepy',
      expression: 'sleepy_eyes',
      animationId: 'anim.sleepy.yawn',
      messageKey: 'mascot.time.evening',
      ...(costumeId ? { costumeId } : {}),
      priorityTag: seasonalTag,
    });
  }

  // --- 10) Friendly default ----------------------------------------------
  return presentation({
    mood: 'friendly',
    expression: 'soft_smile',
    animationId: 'anim.idle.breathe',
    messageKey: 'mascot.default.friendly',
    ...(costumeId ? { costumeId } : {}),
    priorityTag: seasonalTag,
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers exported for the hook / tests                                      */
/* -------------------------------------------------------------------------- */

/**
 * Stable, debug-friendly description of the context. Useful in tests and
 * diagnostics. Never displayed raw to children.
 */
export interface MascotContextDigest {
  hoursAway: number | null;
  daysAway: number | null;
  streak: number;
  questsRemaining: number;
  questsCompletedToday: number;
  isFirstMeeting: boolean;
  comeback: boolean;
  hasCostume: boolean;
}

/**
 * Reduce a context to a small, safe summary the hook can stash for tests.
 */
export function digestMascotContext(context: MascotContext | undefined | null): MascotContextDigest {
  const safeNow = typeof context?.now === 'number' && Number.isFinite(context.now)
    ? context.now
    : Date.now();
  const lastActiveAt = context?.activity?.lastActiveAt;
  const hasLastActive = typeof lastActiveAt === 'number' && Number.isFinite(lastActiveAt);
  const hoursAway = hasLastActive ? Math.max(0, (safeNow - (lastActiveAt as number)) / 3_600_000) : null;
  const daysAway = hasLastActive ? daysBetween(safeNow, lastActiveAt as number) : null;
  return {
    hoursAway: hoursAway !== null && Number.isFinite(hoursAway) ? hoursAway : null,
    daysAway,
    streak: safeNonNegativeInteger(context?.activity?.currentStreak),
    questsRemaining: safeNonNegativeInteger(context?.activity?.questsRemaining),
    questsCompletedToday: safeNonNegativeInteger(context?.activity?.questsCompletedToday),
    isFirstMeeting: context?.child?.isFirstMeeting === true,
    comeback: context?.state?.comebackJustOccurred === true,
    hasCostume:
      typeof context?.event?.mascotCostumeId === 'string' &&
      context.event.mascotCostumeId.length > 0,
  };
}