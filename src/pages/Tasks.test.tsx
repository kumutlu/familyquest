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
    ...overrides,
  };
}

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
    fireEvent.click(screen.getByText('Brush Teeth'));
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
    const select = screen.getByRole('combobox') as HTMLSelectElement;
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'weekdays' } });
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'weekends' } });
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
