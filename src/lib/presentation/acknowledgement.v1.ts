/**
 * Presentation-only acknowledgement store.
 *
 * Used to suppress a one-time celebration beat across remounts and
 * refreshes. UI state only — MUST NOT be reward authority.
 *
 * Persistence: per-tab in-memory. Survives remounts inside the same
 * page lifetime. Lost on full reload — that's intentional: a fresh
 * session is allowed to see the celebration once.
 *
 * Why this lives in lib/presentation and not in Firestore:
 *   - Firestore would imply durable state, which the celebration beat
 *     explicitly does NOT need.
 *   - Acknowledgement is a presentation choice. The reward itself
 *     lives in the gamification processor.
 */

const revealedIds = new Set<string>();
const comebackCompletionKeys = new Set<string>();

/**
 * Mark a Mystery Drop id as acknowledged. Subsequent `isAcknowledged`
 * calls return `true` for the same id until full reload.
 */
export function acknowledgeMysteryReveal(dropId: string): void {
  if (typeof dropId !== 'string' || dropId.length === 0) return;
  revealedIds.add(dropId);
}

/** Has this Mystery Drop been acknowledged in this session? */
export function isMysteryRevealAcknowledged(dropId: string): boolean {
  if (typeof dropId !== 'string' || dropId.length === 0) return false;
  return revealedIds.has(dropId);
}

/** Test-only / preview-only reset hook. */
export function resetAcknowledgementForTests(): void {
  revealedIds.clear();
  comebackCompletionKeys.clear();
}

/**
 * Mark a Comeback completion as acknowledged. The key includes the
 * tier + family-local date so the same tier can celebrate again on a
 * new day (different return after the calendar has moved on).
 */
export function acknowledgeComebackCompletion(key: string): void {
  if (typeof key !== 'string' || key.length === 0) return;
  comebackCompletionKeys.add(key);
}

/** Has this Comeback completion already been acknowledged in this session? */
export function isComebackCompletionAcknowledged(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return comebackCompletionKeys.has(key);
}