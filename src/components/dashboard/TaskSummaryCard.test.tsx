import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

const baseStore = {
  currentUser: { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' },
  tasks: [] as any[],
  taskCompletions: [] as any[],
  bootstrapStatus: { tasks: 'ready' } as any,
  retryFeature: vi.fn(),
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

import { TaskSummaryCard } from './TaskSummaryCard';

function dueDate(d: Date) {
  return { toDate: () => d };
}

describe('TaskSummaryCard', () => {
  beforeEach(async () => {
    h.navigate.mockClear();
    await i18n.loadNamespaces(['dashboard']);
    await i18n.changeLanguage('en');
    baseStore.currentUser = { id: 'u-1', familyId: 'f-1', role: 'child', displayName: 'Kid' };
    baseStore.tasks = [];
    baseStore.taskCompletions = [];
    baseStore.bootstrapStatus = { tasks: 'ready' };
  });

  it('shows active task count and completion summary', () => {
    baseStore.tasks = [
      { id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'u-1' },
      { id: 't-2', title: 'Make bed', isActive: true, assigneeId: 'u-1' },
      { id: 't-3', title: 'Archived', isActive: false, assigneeId: 'u-1' },
    ];
    baseStore.taskCompletions = [
      { taskId: 't-1', assigneeId: 'u-1', status: 'approved' },
    ];
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('task-summary')).toBeInTheDocument();
    // Archived task excluded -> 2 active.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('shows a due-today count when a task is due today', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    baseStore.tasks = [
      { id: 't-1', title: 'Homework', isActive: true, assigneeId: 'u-1', dueDate: dueDate(today) },
      { id: 't-2', title: 'Tidy', isActive: true, assigneeId: 'u-1' },
    ];
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.getByText('1 due today')).toBeInTheDocument();
  });

  it('does not show due-today when no dueDate is present', () => {
    baseStore.tasks = [
      { id: 't-1', title: 'Homework', isActive: true, assigneeId: 'u-1' },
    ];
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.queryByText(/due today/)).not.toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no active tasks', () => {
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.getByText('No active tasks yet.')).toBeInTheDocument();
  });

  it('shows a local skeleton instead of an empty state while tasks load', () => {
    baseStore.bootstrapStatus = { tasks: 'loading' };
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('task-summary-loading')).toBeInTheDocument();
    expect(screen.queryByText('No active tasks yet.')).not.toBeInTheDocument();
  });

  it('shows a local recoverable state when tasks fail', () => {
    baseStore.bootstrapStatus = { tasks: 'error' };
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('task-summary-error')).toBeInTheDocument();
  });

  it('whole card links to /tasks and is keyboard accessible', () => {
    baseStore.tasks = [{ id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'u-1' }];
    render(<MemoryRouter><TaskSummaryCard /></MemoryRouter>);
    const card = screen.getByTestId('task-summary');
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/tasks');
    h.navigate.mockClear();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(h.navigate).toHaveBeenCalledWith('/tasks');
  });
});
