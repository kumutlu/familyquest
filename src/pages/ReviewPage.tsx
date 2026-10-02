import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { SwipeReview } from '../components/parent/SwipeReview';
import { ApprovalCenter } from '../components/parent/ApprovalCenter';
import { selectUnifiedReviewQueue } from '../lib/quests/reviewQueue';
import { countPendingApprovals } from '../lib/home/priorities';
import { isPetBoxEnabled } from '../lib/familyFeatures';

/**
 * Route wrapper for the review flows. Parent-only: children and
 * unauthenticated visitors are redirected (role permission enforcement lives
 * in Firestore rules; this is purely presentational routing).
 *
 * The fast-swipe flow supports quest completions, transfers and money requests.
 * If any other pending approval kind exists, route to the full Approval Center
 * instead so Home can never say "waiting for you" while Review says "all caught up".
 */
export function ReviewPage() {
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const childQrJoinRequests = useStore(state => state.childQrJoinRequests);
  const tasks = useStore(state => state.tasks);
  const taskCompletions = useStore(state => state.taskCompletions);
  const transferRequests = useStore(state => state.transferRequests);
  const moneyRequests = useStore(state => state.moneyRequests);
  const petboxRequests = useStore(state => state.petboxRequests);
  const profileUpdateRequests = useStore(state => state.profileUpdateRequests);
  const goalRequests = useStore(state => state.goalRequests);
  const childJoinRequests = useStore(state => state.childJoinRequests);
  const familyMembers = useStore(state => state.familyMembers);
  const familyData = useStore(state => state.familyData);
  const bootstrapStatus = useStore(state => state.bootstrapStatus);

  const qrStatus = bootstrapStatus?.['childQrJoinRequests'];
  const isQrLoading =
    Boolean(bootstrapStatus) &&
    (qrStatus === 'loading' || qrStatus === 'idle');
  const isQrError = qrStatus === 'error';

  const swipeQueueCount = selectUnifiedReviewQueue({
    completions: taskCompletions || [],
    tasks: tasks || [],
    members: familyMembers || [],
    transferRequests: transferRequests || [],
    moneyRequests: moneyRequests || [],
  }).length;

  const totalPendingCount = countPendingApprovals({
    taskCompletions: taskCompletions || [],
    transferRequests: transferRequests || [],
    moneyRequests: moneyRequests || [],
    petboxRequests: petboxRequests || [],
    profileUpdateRequests: profileUpdateRequests || [],
    goalRequests: goalRequests || [],
    childJoinRequests: childJoinRequests || [],
    childQrJoinRequests: childQrJoinRequests || [],
    petBoxEnabled: isPetBoxEnabled(familyData),
  });

  // Any pending item that cannot be rendered by SwipeReview must fall back to
  // ApprovalCenter. This includes profile/goal/Pet Box/child-join/QR requests.
  const hasNonSwipeApprovals = totalPendingCount > swipeQueueCount;

  useEffect(() => {
    if (!currentUser) {
      navigate('/login', { replace: true });
    } else if (!isParentRole(currentUser.role)) {
      navigate('/tasks', { replace: true });
    }
  }, [currentUser, navigate]);

  if (!currentUser || !isParentRole(currentUser.role)) return null;

  if (isQrLoading) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4" data-testid="review-page-loading" aria-busy="true">
        <div className="h-64 animate-pulse rounded-card qk-bg-inset mb-4" aria-hidden="true" />
        <div className="h-14 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
      </div>
    );
  }

  if (hasNonSwipeApprovals || isQrError) {
    return (
      <div className="max-w-2xl mx-auto py-4 px-2">
        <ApprovalCenter />
      </div>
    );
  }

  return <SwipeReview />;
}
