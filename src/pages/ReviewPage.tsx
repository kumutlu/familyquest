import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { SwipeReview } from '../components/parent/SwipeReview';
import { ApprovalCenter } from '../components/parent/ApprovalCenter';

/**
 * Route wrapper for the review flows. Parent-only: children and
 * unauthenticated visitors are redirected (role permission enforcement lives
 * in Firestore rules; this is purely presentational routing).
 *
 * When pending child QR device requests exist, displays the full Approval Center
 * where the parent can select the child profile and approve the device binding.
 * Otherwise, presents the standard fast-swipe review flow.
 */
export function ReviewPage() {
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const childQrJoinRequests = useStore(state => state.childQrJoinRequests);
  const hasQrRequests = (childQrJoinRequests || []).some((r: any) => r.status === 'pending');

  useEffect(() => {
    if (!currentUser) {
      navigate('/login', { replace: true });
    } else if (!isParentRole(currentUser.role)) {
      navigate('/tasks', { replace: true });
    }
  }, [currentUser, navigate]);

  if (!currentUser || !isParentRole(currentUser.role)) return null;

  if (hasQrRequests) {
    return (
      <div className="max-w-2xl mx-auto py-4 px-2">
        <ApprovalCenter />
      </div>
    );
  }

  return <SwipeReview />;
}
