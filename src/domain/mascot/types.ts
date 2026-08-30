/**
 * FamilyQuest / Queki — Mascot Engine V1.
 *
 * The mascot engine is the **engagement** layer for the child product.
 * It reads existing state and returns a presentation — mood, expression,
 * animation id, costume ID, message key. It NEVER awards points, XP,
 * wallet balance, streaks, completions, or approvals. It NEVER writes
 * to Firestore. It is read-only with respect to gamification.
 *
 * Architectural rules (audit checklist)
 * -------------------------------------
 *  1. No write paths to authoritative XP / points / wallet collections.
 *  2. No Firestore Rules changes — this package is pure presentation.
 *  3. One resolver. One hook. Components consume the resolved presentation,
 *     not the raw context, so mood priority cannot drift across screens.
 *  4. Unknown / malformed timestamps, missing names, and absent activity
 *     fall back to a friendly default. The mascot NEVER throws.
 *  5. The mascot does not know what Christmas, Ramadan, or Neon Week mean.
 *     It only consumes `mascotCostumeId` from the resolved Experience
 *     Theme; the Event + Theme Engine owns the celebration logic.
 *  6. Returning users are WELCOMED, never punished. Tone is playful,
 *     theatrical, cheeky — never guilt-heavy, shame-heavy, or threatening.
 *  7. Message text is deterministic: a curated template store keyed by
 *     `messageKey`. No runtime AI generation. No arbitrary user content.
 *
 * Separation boundaries
 * ---------------------
 *   Mascot Engine    = presentation / reaction
 *   Gamification Eng = value / progression
 *   Notification Eng = delivery
 *   Event Engine     = opportunities / context
 */

/* -------------------------------------------------------------------------- */
/* Mood taxonomy                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic mascot moods. The order in this union is *not* priority —
 * priority is encoded in {@link resolveMascotPresentation}. The order
 * here is the order the resolver typically inspects them.
 *
 * Allowed tones: playful, theatrical, cheeky.
 * Disallowed tones: guilt, shame, fear, threats, financial pressure.
 */
export type MascotMood =
  | 'friendly'
  | 'excited'
  | 'proud'
  | 'sleepy'
  | 'curious'
  | 'suspicious'
  | 'grumpy'
  | 'sad'
  | 'shocked'
  | 'celebrating'
  | 'welcome_back';

/* -------------------------------------------------------------------------- */
/* Expressions and animations                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The geometry / face shape the renderer should draw. The engine does not
 * own pixels — it picks an identifier the renderer maps to art.
 */
export type MascotExpression =
  | 'soft_smile'
  | 'big_smile'
  | 'wink'
  | 'closed_eyes'
  | 'wide_eyes'
  | 'raised_eyebrow'
  | 'frown'
  | 'sleepy_eyes'
  | 'open_mouth'
  | 'sparkle'
  | 'sparkle_burst';

/**
 * A deterministic identifier for a CSS / Lottie / Rive animation. The
 * renderer (not this engine) maps `animationId` to actual playback. The
 * engine never embeds runtime data; it just names the animation.
 */
export type MascotAnimationId =
  | 'anim.idle.breathe'
  | 'anim.idle.bob'
  | 'anim.talk.bounce'
  | 'anim.celebrate.jump'
  | 'anim.curious.tilt'
  | 'anim.sleepy.yawn'
  | 'anim.suspicious.look_around'
  | 'anim.shocked.jump_back'
  | 'anim.welcome.wave'
  | 'anim.proud.chest_puff';

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The complete presentation bundle returned by the resolver. Components
 * take this and render — they NEVER branch on `mood === '...'` inline.
 */
export interface MascotPresentation {
  /** Which mood the character should express. */
  mood: MascotMood;
  /** Which face / expression geometry to render. */
  expression: MascotExpression;
  /**
   * Optional seasonal / event costume reference. The mascot engine does
   * NOT interpret this — it just forwards the value supplied by the
   * resolved Experience Theme. `undefined` means "no costume".
   */
  costumeId?: string;
  /**
   * Optional animation id. When omitted, the renderer falls back to its
   * per-mood default animation.
   */
  animationId?: MascotAnimationId;
  /**
   * i18n key into the curated mascot message catalog. The renderer looks
   * up a deterministic variant for this key. NEVER render raw user text.
   */
  messageKey: string;
  /**
   * Diagnostic priority tag — never displayed raw. Useful for tests and
   * debug tooling. Components must not show this to children.
   */
  priorityTag:
    | 'level-up'
    | 'all-quests-complete'
    | 'welcome-back'
    | 'long-inactivity'
    | 'streak-at-risk'
    | 'all-quests-done-no-streak'
    | 'new-user'
    | 'time-of-day'
    | 'seasonal'
    | 'default';
}

/* -------------------------------------------------------------------------- */
/* Resolver inputs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The read-only context the resolver needs. V1 must NOT require new
 * authoritative counters — it composes from existing data shapes.
 *
 * Every field is optional and defensively defaulted inside the resolver.
 * The hook hides Firestore / Zustand wiring behind this single shape.
 */
export interface MascotContext {
  /** Always supplied. Epoch ms. */
  now: number;
  /** Optional child profile metadata. */
  child?: {
    displayName?: string;
    /** True when this is the child's very first dashboard visit. */
    isFirstMeeting?: boolean;
  };
  /** Optional activity / progression snapshot. */
  activity?: {
    /** Last time the child opened the dashboard / completed a quest. */
    lastActiveAt?: number;
    /** Current streak length in days. */
    currentStreak?: number;
    /** Quests remaining for today. */
    questsRemaining?: number;
    /** Quests the child has already completed today. */
    questsCompletedToday?: number;
    /** True when every active quest for the day has been completed. */
    allQuestsCompleted?: boolean;
  };
  /** Optional progression flags. */
  progression?: {
    /** A level-up just occurred this visit. V1 derives this from inputs. */
    levelUpJustOccurred?: boolean;
  };
  /** Optional event / theme integration — sourced from the Experience Engine. */
  event?: {
    /** The id of the active theme (e.g. `theme.christmas`). */
    activeThemeId?: string;
    /** The mascot costume the active theme provides. */
    mascotCostumeId?: string;
  };
  /** Optional state-machine flags. */
  state?: {
    /** Welcome-back signal: child was inactive and is now returning. */
    comebackJustOccurred?: boolean;
  };
}

/**
 * The shape the resolver consumes. Wraps the context with theme-derived
 * costume metadata so callers don't have to pass it separately.
 */
export interface ResolveMascotPresentationInput {
  /** Activity / child / progression / event snapshot. */
  context: MascotContext;
  /**
   * The resolved Experience Theme costume. When omitted, the resolver
   * still works and the presentation simply carries no costume.
   */
  resolvedCostumeId?: string;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

/** Thresholds the resolver uses. Kept as a single frozen object. */
export const MASCOT_THRESHOLDS = Object.freeze({
  /** "long inactivity" in days. Above this → `grumpy` (playful). */
  LONG_INACTIVITY_DAYS: 3,
  /** "short inactivity" in days. Above this → `suspicious`. */
  SHORT_INACTIVITY_DAYS: 1,
  /** Local hour at which we start saying "morning" instead of "friendly". */
  MORNING_CUTOFF_HOUR: 11,
  /** Local hour at which we say "sleepy" / late. */
  EVENING_CUTOFF_HOUR: 21,
  /** Day-key derived from `lastActiveAt` vs `now`. */
  MS_PER_DAY: 86_400_000,
});

/** Safe default presentation — every unknown input lands here. */
export const DEFAULT_MASCOT_PRESENTATION: MascotPresentation = Object.freeze({
  mood: 'friendly',
  expression: 'soft_smile',
  messageKey: 'mascot.default.friendly',
  animationId: 'anim.idle.breathe',
  priorityTag: 'default',
}) as MascotPresentation;