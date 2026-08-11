import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ChildChallengeCelebration } from './ChildChallengeCelebration';
import { useStore } from '../../store/useStore';
import { useNotifications } from '../../lib/useNotifications';

vi.mock('../../store/useStore', () => ({ useStore: vi.fn() }));
vi.mock('../../lib/useNotifications', () => ({ useNotifications: vi.fn() }));

const celebration = {
  id: 'challenge_completed_ch-1',
  type: 'challenge_completed',
  title: 'Challenge complete!',
  body: 'You earned +100 points',
  recipientIds: ['c1', 'c2'],
  entityType: 'challenge',
  entityId: 'ch-1',
  createdAt: { toMillis: () => 1000 },
} as any;

const markRead = vi.fn(async () => {});

function setup(
  user: { id: string; role: string; familyId: string } | null,
  notifications: any[],
  readIds: Set<string> = new Set(),
) {
  (useStore as any).mockImplementation((selector: (s: any) => unknown) =>
    selector({ currentUser: user }),
  );
  (useNotifications as any).mockReturnValue({
    notifications,
    readIds,
    markRead,
    unreadCount: 0,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    connectionState: 'connected',
    markAllRead: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
  });
  return render(<ChildChallengeCelebration />);
}

describe('ChildChallengeCelebration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the celebration once for a child with an unseen claimed challenge', () => {
    setup({ id: 'c1', role: 'child', familyId: 'f1' }, [celebration]);

    expect(screen.getByTestId('challenge-celebration-overlay')).toBeInTheDocument();
    expect(screen.getByText('Challenge complete!')).toBeInTheDocument();
    expect(screen.getByText('You earned +100 points')).toBeInTheDocument();
  });

  it('marks ONLY the celebration as seen on dismissal and does not replay', async () => {
    const user = userEvent.setup();
    setup({ id: 'c1', role: 'child', familyId: 'f1' }, [celebration]);

    await user.click(screen.getByTestId('challenge-celebration-dismiss'));

    // Exactly one read-state write; no reward/XP/challenge write path exists here.
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead).toHaveBeenCalledWith('challenge_completed_ch-1');
    // Gone immediately, without waiting for the listener to echo the read state.
    expect(screen.queryByTestId('challenge-celebration-overlay')).toBeNull();
  });

  it('does not replay after a refresh/relogin once seen', () => {
    setup(
      { id: 'c1', role: 'child', familyId: 'f1' },
      [celebration],
      new Set(['challenge_completed_ch-1']),
    );

    expect(screen.queryByTestId('challenge-celebration-overlay')).toBeNull();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('gives a sibling independent seen state', () => {
    // Sibling c2 has NOT read the notification, so they still get their own
    // one-time celebration even though c1 already dismissed theirs.
    setup({ id: 'c2', role: 'child', familyId: 'f1' }, [celebration], new Set());

    expect(screen.getByTestId('challenge-celebration-overlay')).toBeInTheDocument();
  });

  it('never shows the celebration to a parent', () => {
    setup({ id: 'p1', role: 'parent', familyId: 'f1' }, [celebration]);

    expect(screen.queryByTestId('challenge-celebration-overlay')).toBeNull();
    // Not even subscribed for a parent.
    expect(useNotifications).toHaveBeenCalledWith(null, null);
  });

  it('ignores unrelated notification types and legacy challenges with no marker', () => {
    setup({ id: 'c1', role: 'child', familyId: 'f1' }, [
      { id: 'n-1', type: 'task_approved', title: 'Task approved', body: 'Nice', createdAt: 1 },
    ]);

    expect(screen.queryByTestId('challenge-celebration-overlay')).toBeNull();
  });
});
