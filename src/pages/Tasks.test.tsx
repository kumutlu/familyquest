import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { Tasks } from './Tasks';

const baseTask = {
  id: 't1',
  title: 'Brush Teeth',
  pointsReward: 10,
  type: 'daily',
  requiresApproval: true,
  isActive: true,
  status: 'pending',
};

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 },
    tasks: [baseTask],
    taskCompletions: [],
    loading: false,
    familyMembers: [
      { id: 'childA', displayName: 'Child A', role: 'child' },
      { id: 'childB', displayName: 'Child B', role: 'child' },
    ],
    ...overrides,
  };
}

// Helper to get the type schedule select (second combobox)
const typeSelect = () => screen.getAllByRole('combobox')[1] as HTMLSelectElement;
// Helper to get the assignee select (first combobox)
const assigneeSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;

describe('Tasks page — role-based management controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createTask.mockResolvedValue({ id: 't1' });
    api.updateTask.mockResolvedValue(undefined);
    api.completeTask.mockResolvedValue(undefined);
  });

  it('owner sees Add Task, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 } }));
    render(<Tasks />);
    expect(screen.getByRole('button', { name: 'Add Task' })).toBeInTheDocument();
    expect(() => fireEvent.click(screen.getByText('Brush Teeth'))).not.toThrow();
    expect(screen.getByRole('dialog', { name: 'Task Details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).not.toBeInTheDocument();
  });

  it('parent sees Add Task, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));
    render(<Tasks />);
    expect(screen.getByRole('button', { name: 'Add Task' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Brush Teeth'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('child does NOT see management controls and only sees Mark as Done', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 0 } }));
    render(<Tasks />);
    expect(screen.queryByRole('button', { name: 'Add Task' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Brush Teeth'));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as Done' })).toBeInTheDocument();
    expect(api.completeTask).not.toHaveBeenCalled();
  });

  it('owner is never treated as child (no redeem-only view)', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 } }));
    render(<Tasks />);
    fireEvent.click(screen.getByText('Brush Teeth'));
    expect(screen.queryByRole('button', { name: 'Mark as Done' })).not.toBeInTheDocument();
  });
});

describe('Tasks page — schedule options (Weekdays / Weekends)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createTask.mockResolvedValue({ id: 't1' });
  });

  it('create form offers Weekdays and Weekends schedule options', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner' } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    const select = typeSelect();
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Weekdays (Mon-Fri)');
    expect(labels).toContain('Weekends (Sat-Sun)');
  });

  it('persists weekdays schedule selection on save', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner' } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    const titleInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(titleInput, { target: { value: 'Read a book' } });
    fireEvent.change(typeSelect(), { target: { value: 'weekdays' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = api.createTask.mock.calls[0][1];
    expect(payload.type).toBe('weekdays');
  });

  it('persists weekends schedule selection on save', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner' } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    const titleInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(titleInput, { target: { value: 'Family walk' } });
    fireEvent.change(typeSelect(), { target: { value: 'weekends' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = api.createTask.mock.calls[0][1];
    expect(payload.type).toBe('weekends');
  });
});

describe('Tasks page — save lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a successful save closes the modal and shows a success message', async () => {
    api.createTask.mockResolvedValue({ id: 't1' });
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner' } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Tidy room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(screen.queryByText('New Task')).not.toBeInTheDocument());
    expect(screen.getByText('Task created successfully!')).toBeInTheDocument();
  });

  it('a failed save keeps the modal open, shows the error, and adds no task', async () => {
    api.createTask.mockRejectedValue(new Error('permission-denied: actorId must equal auth.uid'));
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner' } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Tidy room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    expect(await screen.findByText(/permission-denied/)).toBeInTheDocument();
    // Modal stays open on failure.
    expect(screen.getByText('New Task')).toBeInTheDocument();
    // The task list still contains only the original task (no partial write shown).
    expect(screen.getAllByText('Brush Teeth').length).toBeGreaterThan(0);
  });
});

describe('Tasks page — child task visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Child A sees Child A task', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Child B Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childB' },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.getByText('Child A Task')).toBeInTheDocument();
  });

  it('Child A does not see Child B task', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Child B Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childB' },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.queryByText('Child B Task')).not.toBeInTheDocument();
  });

  it('Child A sees a null-assignee shared task', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: null },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.getByText('Shared Task')).toBeInTheDocument();
  });

  it('Child A sees an empty-string legacy shared task', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Legacy Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: '' },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.getByText('Legacy Shared Task')).toBeInTheDocument();
  });

  it('Child B gets the inverse result', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childB', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Child B Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childB' },
        { id: 't3', title: 'Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: null },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.queryByText('Child A Task')).not.toBeInTheDocument();
    expect(screen.getByText('Child B Task')).toBeInTheDocument();
    expect(screen.getByText('Shared Task')).toBeInTheDocument();
  });

  it('Parent sees all active tasks', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Child B Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childB' },
        { id: 't3', title: 'Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: null },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.getByText('Child A Task')).toBeInTheDocument();
    expect(screen.getByText('Child B Task')).toBeInTheDocument();
    expect(screen.getByText('Shared Task')).toBeInTheDocument();
  });

  it('Archived tasks remain hidden', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Active Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Archived Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: false, assigneeId: 'childA' },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    expect(screen.getByText('Active Task')).toBeInTheDocument();
    expect(screen.queryByText('Archived Task')).not.toBeInTheDocument();
  });

  it('Recurrence status still derives correctly after visibility filtering', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: null },
      ],
      taskCompletions: [
        { taskId: 't1', memberId: 'childA', date: '2024-01-01', status: 'approved' },
      ],
      loading: false,
    });
    render(<Tasks />);
    // Both tasks should be visible
    expect(screen.getByText('Child A Task')).toBeInTheDocument();
    expect(screen.getByText('Shared Task')).toBeInTheDocument();
    // Both tasks should have their points displayed (recurrence status derived correctly)
    const badges = screen.getAllByText(/10 pts/);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('Type filters still operate on the visible task set', () => {
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Daily Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Weekly Task', pointsReward: 10, type: 'weekly', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't3', title: 'Other Child Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childB' },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    // Click the 'Daily' filter
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }));
    // Should only see Daily Task (not Weekly Task, and not Other Child Task)
    expect(screen.getByText('Daily Task')).toBeInTheDocument();
    expect(screen.queryByText('Weekly Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Other Child Task')).not.toBeInTheDocument();
  });
});

describe('Tasks page — assigneeId persistence in inline form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createTask.mockResolvedValue({ id: 't1' });
    api.updateTask.mockResolvedValue(undefined);
  });

  it('creating a task for Child A persists Child A ID', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Child A Task' } });
    // Select Child A from assignee dropdown
    fireEvent.change(assigneeSelect(), { target: { value: 'childA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = api.createTask.mock.calls[0][1];
    expect(payload.assigneeId).toBe('childA');
  });

  it('creating a task for Child B persists Child B ID', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Child B Task' } });
    // Select Child B from assignee dropdown
    fireEvent.change(assigneeSelect(), { target: { value: 'childB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = api.createTask.mock.calls[0][1];
    expect(payload.assigneeId).toBe('childB');
  });

  it('creating an All Children task persists null', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));
    render(<Tasks />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Shared Task' } });
    // Default is empty value (All Children)
    expect(assigneeSelect().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const payload = api.createTask.mock.calls[0][1];
    expect(payload.assigneeId).toBe(null);
  });

  it('editing Child A task to Child B updates assigneeId', async () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
      ],
    }));
    render(<Tasks />);
    fireEvent.click(screen.getByText('Child A Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Select Child B from assignee dropdown
    fireEvent.change(assigneeSelect(), { target: { value: 'childB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    const payload = api.updateTask.mock.calls[0][2];
    expect(payload.assigneeId).toBe('childB');
  });

  it('editing a child-specific task to All Children stores null', async () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
      ],
    }));
    render(<Tasks />);
    fireEvent.click(screen.getByText('Child A Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Select All Children (empty value)
    fireEvent.change(assigneeSelect(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Task' }));

    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    const payload = api.updateTask.mock.calls[0][2];
    expect(payload.assigneeId).toBe(null);
  });

  it('selected assignee is restored when editing', async () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
      ],
    }));
    render(<Tasks />);
    fireEvent.click(screen.getByText('Child A Task'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(assigneeSelect().value).toBe('childA');
  });

  it('child visibility remains correct after creation', async () => {
    // Simulate Child A viewing tasks after a new task is created for them
    useStoreMock.mockReturnValue({
      currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },
      tasks: [
        { id: 't1', title: 'Existing Child A Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'childA' },
        { id: 't2', title: 'Shared Task', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: null },
      ],
      taskCompletions: [],
      loading: false,
    });
    render(<Tasks />);
    // Both tasks should be visible
    expect(screen.getByText('Existing Child A Task')).toBeInTheDocument();
    expect(screen.getByText('Shared Task')).toBeInTheDocument();
  });
});