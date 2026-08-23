import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { periodKeyFor } from '../../lib/taskRecurrence';

const TODAY_KEY = periodKeyFor('daily', new Date());

const api = vi.hoisted(() => ({ completeTask: vi.fn() }));
vi.mock('../../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { QuestBoard } from './QuestBoard';

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'childA', familyId: 'fam', role: 'child', ["rewardPoints"]: 0, currentStreak: 3 },
    tasks: [],
    taskCompletions: [],
    familyMembers: [{ id: 'p1', displayName: 'Dad', role: 'owner' }],
    bootstrapStatus: { tasks: 'ready', members: 'ready' },
    ...overrides,
  };
}

const todayTask = {
  id: 't1',
  title: 'Feed the cat',
  pointsReward: 10,
  type: 'daily',
  requiresApproval: true,
  isActive: true,
  assigneeId: null,
};

describe('QuestBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows structured skeletons while snapshots hydrate — never a false empty state', () => {
    useStoreMock.mockReturnValue(makeStore({ bootstrapStatus: { tasks: 'loading', members: 'loading' } }));
    render(<QuestBoard />);
    expect(screen.getByTestId('quest-board-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('quest-board-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-progress')).not.toBeInTheDocument();
  });

  it('renders the featured quest and Today progress for an available quest', () => {
    useStoreMock.mockReturnValue(makeStore({ tasks: [todayTask] }));
    render(<QuestBoard />);
    expect(screen.getByTestId('featured-quest')).toBeInTheDocument();
    expect(screen.getByText('Feed the cat')).toBeInTheDocument();
    expect(screen.getByTestId('today-progress')).toHaveTextContent('0 of 1');
  });

  it('a pending quest cannot be resubmitted and is visually distinct', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        tasks: [todayTask],
        taskCompletions: [
          { id: 'c1', taskId: 't1', assigneeId: 'childA', status: 'pending_approval', periodKey: TODAY_KEY },
        ],
      }),
    );
    render(<QuestBoard />);
    // Pending card shown; no hold-to-complete control anywhere on the board.
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();
    expect(screen.queryByTestId('hold-to-complete')).not.toBeInTheDocument();
    // Submitted count surfaced separately from confirmed progress.
    expect(screen.getByTestId('submitted-chip')).toBeInTheDocument();
    expect(screen.getByTestId('today-progress')).toHaveTextContent('0 of 1');
  });

  it('pending state derives from authoritative data and survives re-render/reload', () => {
    const store = makeStore({
      tasks: [todayTask],
      taskCompletions: [
        { id: 'c1', taskId: 't1', assigneeId: 'childA', status: 'pending_approval', periodKey: TODAY_KEY },
      ],
    });
    useStoreMock.mockReturnValue(store);
    const { unmount } = render(<QuestBoard />);
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();
    unmount();
    // "Reload": fresh mount from the same authoritative snapshot.
    useStoreMock.mockReturnValue(makeStore({
      tasks: [todayTask],
      taskCompletions: [
        { id: 'c1', taskId: 't1', assigneeId: 'childA', status: 'pending_approval', periodKey: TODAY_KEY },
      ],
    }));
    render(<QuestBoard />);
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();
  });

  it('never renders confirmed XP before approval — only potential wording', () => {
    useStoreMock.mockReturnValue(makeStore({ tasks: [todayTask] }));
    render(<QuestBoard />);
    // The board itself never claims confirmed points for an active quest.
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
  });

  it('an approved quest moves to the done strip and updates the confirmed ratio', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        tasks: [todayTask],
        taskCompletions: [
          { id: 'c1', taskId: 't1', assigneeId: 'childA', status: 'approved', periodKey: TODAY_KEY },
        ],
      }),
    );
    render(<QuestBoard />);
    expect(screen.getByTestId('done-quest')).toBeInTheDocument();
    expect(screen.getByTestId('today-progress')).toHaveTextContent('1 of 1');
  });

  it('a rejected quest offers a calm retry with the parent comment', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        tasks: [todayTask],
        taskCompletions: [
          {
            id: 'c1',
            taskId: 't1',
            assigneeId: 'childA',
            status: 'rejected',
            periodKey: TODAY_KEY,
            parentComment: 'Please redo it',
          },
        ],
      }),
    );
    render(<QuestBoard />);
    expect(screen.getByText(/Not approved this time/)).toBeInTheDocument();
    expect(screen.getByText(/Please redo it/)).toBeInTheDocument();
    // Retry keeps the quest actionable.
    expect(screen.getByTestId('hold-to-complete')).toBeInTheDocument();
  });

  it('shows the nothing-waiting empty state when there are no quests', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<QuestBoard />);
    expect(screen.getByTestId('quest-board-empty')).toBeInTheDocument();
  });

  it('shows the all-done state when every actionable quest is approved', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        tasks: [todayTask],
        taskCompletions: [
          { id: 'c1', taskId: 't1', assigneeId: 'childA', status: 'approved', periodKey: TODAY_KEY },
        ],
      }),
    );
    render(<QuestBoard />);
    expect(screen.getByTestId('quest-board-all-done')).toBeInTheDocument();
  });
});
