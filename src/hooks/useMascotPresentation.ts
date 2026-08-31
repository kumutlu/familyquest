/**
 * React hook for the FamilyQuest / Queki Mascot Engine.
 *
 * The hook is the ONLY place that turns the gamification store + i18n +
 * Experience Theme into a {@link MascotPresentation}. Components consume
 * the resolved bundle. They NEVER read store state for mascot purposes.
 *
 * V1 sources (READ-ONLY):
 *   - `useExperienceTheme()` → resolved costume id
 *   - `useTranslation()` → current locale for message selection
 *   - caller-supplied context (display name, streak, quest counts,
 *     first-meeting flag) via `useMascotPresentationFor`
 *   - `Date.now()` → local hour and clock
 *
 * V1 does NOT write anything to gamification. It does not modify streaks,
 * does not award XP, does not complete tasks. It only observes.
 *
 * Tests inject deterministic clocks via `setMascotClock` or by calling
 * `resolveMascotPresentation` directly with synthetic input.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listMascotMessages,
  resolveMascotPresentation,
  selectMascotMessage,
  type MascotContext,
  type MascotMessageVariables,
  type MascotPresentation,
} from '../domain/mascot';
import { useExperienceTheme } from './useExperienceTheme';

/* -------------------------------------------------------------------------- */
/* Clock injection (deterministic tests)                                      */
/* -------------------------------------------------------------------------- */

let clock: () => number = () => Date.now();

/**
 * Replace the hook's clock. Returns a disposer to restore production.
 */
export function setMascotClock(override: () => number): () => void {
  const previous = clock;
  clock = override;
  return () => {
    clock = previous;
  };
}

/* -------------------------------------------------------------------------- */
/* Shared shape                                                               */
/* -------------------------------------------------------------------------- */

export interface UseMascotPresentationResult {
  /** The resolved mascot presentation bundle. */
  presentation: MascotPresentation;
  /**
   * Pre-formatted message line, ready to render. Pulls the i18n locale
   * and interpolates `displayName` / `streak` / `questsRemaining`.
   * Components MUST render this and not the raw `messageKey`.
   */
  message: string;
  /**
   * All available variants for the current message key, already
   * interpolated. Useful for dev tooling and QA review.
   */
  messageVariants: readonly string[];
  /** Convenience: the active costume id (if any). */
  costumeId: string | undefined;
  /** Convenience: the resolved priority tag — diagnostic only. */
  priorityTag: MascotPresentation['priorityTag'];
}

function buildResult(
  presentation: MascotPresentation,
  locale: string | undefined,
  variables: MascotMessageVariables,
): UseMascotPresentationResult {
  // Stable seed so the same locale+key pair picks the same variant today.
  // Different days are deliberately out of scope for V1 (the engine itself
  // is deterministic; per-day rotation is a future enhancement).
  const seed = presentation.messageKey.length + (locale?.length ?? 0);
  const message = selectMascotMessage(presentation.messageKey, locale, variables, seed);
  const messageVariants = listMascotMessages(presentation.messageKey, locale, variables);
  return {
    presentation,
    message,
    messageVariants,
    costumeId: presentation.costumeId,
    priorityTag: presentation.priorityTag,
  };
}

/* -------------------------------------------------------------------------- */
/* Public hook (minimal)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Minimal resolver for surfaces that don't supply child-specific context.
 *
 * Reads only:
 *   - resolved costume id (from Experience Theme)
 *   - current locale (from i18n)
 *   - clock (overridable for tests)
 */
export function useMascotPresentation(): UseMascotPresentationResult {
  const { theme } = useExperienceTheme();
  const { i18n } = useTranslation();

  return useMemo(() => {
    const costumeId = theme?.mascotCostumeId;
    const now = clock();
    const presentation = resolveMascotPresentation({
      context: {
        now,
        event: costumeId ? { activeThemeId: theme?.id, mascotCostumeId: costumeId } : undefined,
      },
      resolvedCostumeId: costumeId,
    });
    return buildResult(presentation, i18n.language, {});
  }, [theme, i18n.language]);
}

/* -------------------------------------------------------------------------- */
/* Imperative resolver (for child living home etc.)                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the mascot presentation from an explicit context. Use from screens
 * that know the child's streak, quest count, display name, etc.
 *
 * This is the recommended entry point — it consumes existing read-only
 * state from the gamification / store layer without writing anything.
 */
export function useMascotPresentationFor(
  input: Omit<MascotContext, 'now'>,
): UseMascotPresentationResult {
  const { theme } = useExperienceTheme();
  const { i18n } = useTranslation();

  const costumeId = theme?.mascotCostumeId;

  // Stable memo key: any input field that can change the presentation
  // feeds into this key. Linter-friendly because we enumerate fields once.
  const memoKey = [
    theme?.id ?? '',
    i18n.language ?? '',
    input.child?.displayName ?? '',
    input.child?.isFirstMeeting ? '1' : '0',
    input.activity?.lastActiveAt ?? '',
    input.activity?.currentStreak ?? '',
    input.activity?.questsRemaining ?? '',
    input.activity?.questsCompletedToday ?? '',
    input.activity?.allQuestsCompleted ? '1' : '0',
    input.progression?.levelUpJustOccurred ? '1' : '0',
    input.event?.mascotCostumeId ?? '',
    input.state?.comebackJustOccurred ? '1' : '0',
  ].join('|');

  return useMemo(() => {
    const now = clock();
    const context: MascotContext = { now, ...input };
    const presentation = resolveMascotPresentation({
      context,
      resolvedCostumeId: costumeId,
    });
    const variables: MascotMessageVariables = {
      displayName: input.child?.displayName,
      streak: input.activity?.currentStreak,
      questsRemaining: input.activity?.questsRemaining,
    };
    return buildResult(presentation, i18n.language, variables);
    // The memo key is derived from every input we read. Reading the
    // memo key itself is sufficient to satisfy exhaustive-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costumeId, i18n.language, memoKey]);
}

/** Reset every test seam to the production defaults. */
export function resetMascotState(): void {
  clock = () => Date.now();
}