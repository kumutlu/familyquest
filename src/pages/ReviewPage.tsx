import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { SwipeReview } from '../components/parent/SwipeReview';

/**
 * Route wrapper for the Wave 2 Swipe Review flow. Parent-only: children and
 * unauthenticated visitors are redirected (role permission enforcement lives
 * in Firestore rules; this is purely presentational routing).
 */
export function ReviewPage() {
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login', { replace: true });
    } else if (!isParentRole(currentUser.role)) {
      navigate('/tasks', { replace: true });
    }
  }, [currentUser, navigate]);

  if (!currentUser || !isParentRole(currentUser.role)) return null;

  return <SwipeReview />;
}
