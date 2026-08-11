/**
 * ChildChallengeCelebration
 * ---------------------------------------------------------------------------
 * One-time celebratory overlay shown to a CHILD after a parent has claimed a
 * Family Challenge.
 *
 * Design constraints (deliberate):
 *  - It is PRESENTATION ONLY. It never distributes rewards, never writes
 *    points/XP, and never touches challenge state. The authoritative reward
 *    distribution stays inside `claimChallenge` (src/lib/api.ts).
 *  - The trigger is the already-persisted `challenge_completed` notification
 *    created inside that same claim transaction, and the "seen" state is the
 *    EXISTING per-user `notification_reads` read-state mechanism. No parallel
 *    system, no second write path.
 *  - Dismissing marks ONLY the notification as read, so it cannot replay on the
 *    next login/refresh, while each sibling keeps independent read state.
 *  - Legacy challenges completed before this feature have no
 *    `challenge_completed` notification, so nothing is ever replayed for them.
 *
 * The animation reuses the app's existing celebration animation stylesheet
 * (src/components/rewards/rewardCelebration.css) — the app has no Lottie
 * runtime, so no new animation dependency is introduced.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trophy } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useNotifications } from '../../lib/useNotifications';
import { isChildRole } from '../../lib/roles';
import { toMillis, type NotificationData } from '../../lib/notifications';
import '../rewards/rewardCelebration.css';

export const CHALLENGE_CELEBRATION_TYPE = 'challenge_completed';

/** Picks the newest unseen challenge celebration. Pure and testable. */
export function selectPendingCelebration(
  notifications: NotificationData[],
  readIds: Set<string>,
  dismissedIds: Set<string>,
): NotificationData | null {
  const pending = notifications
    .filter(
      n =>
        !!n &&
        !!n.id &&
        n.type === CHALLENGE_CELEBRATION_TYPE &&
        !readIds.has(n.id) &&
        !dismissedIds.has(n.id),
    )
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return pending[0] ?? null;
}

export function ChildChallengeCelebration() {
  const currentUser = useStore(state => state.currentUser);
  // Parents never see the child celebration: the listeners are not even
  // subscribed for a non-child user.
  const isChild = isChildRole(currentUser?.role);
  const familyId = isChild ? currentUser?.familyId ?? null : null;
  const userId = isChild ? currentUser?.id ?? null : null;

  const { notifications, readIds, markRead } = useNotifications(familyId, userId);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const pending = useMemo(
    () => selectPendingCelebration(notifications, readIds, dismissedIds),
    [notifications, readIds, dismissedIds],
  );

  if (!isChild || !pending) return null;

  const handleClose = () => {
    const id = pending.id;
    // Local dismissal first so the overlay can never flash again while the
    // read-state write is in flight.
    setDismissedIds(prev => new Set(prev).add(id));
    // Marks ONLY the celebration as seen. No points, XP, challenge or reward
    // state is touched here.
    void markRead(id).catch(() => {
      /* A failed read-state write must never break the child's app. */
    });
  };

  const overlay = (
    <div
      className="rc-overlay is-open is-revealed is-ready"
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-celebration-title"
      data-testid="challenge-celebration-overlay"
    >
      <section className="rc-panel">
        <div className="rc-reward-icon" aria-hidden="true">
          <Trophy size={38} />
        </div>
        <h2 className="rc-title" id="challenge-celebration-title">
          {pending.title || 'Challenge complete!'}
        </h2>
        <p className="rc-message" data-testid="challenge-celebration-body">
          {pending.body}
        </p>
        <button
          type="button"
          className="rc-button"
          onClick={handleClose}
          data-testid="challenge-celebration-dismiss"
        >
          Awesome!
        </button>
      </section>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}

export default ChildChallengeCelebration;
