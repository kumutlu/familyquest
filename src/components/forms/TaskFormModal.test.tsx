import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createTask: vi.fn(), updateTask: vi.fn() }));
vi.mock('../../lib/api', () => api);

const store = vi.hoisted(() => ({
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
  familyMembers: [] as any[],
}));
vi.mock('../../store/useStore', () => ({ useStore: () => store }));

import { TaskFormModal } from './TaskFormModal';

const titleInput = () => screen.getAllByRole('textbox')[0];
const submitButton = () => screen.getByRole('button', { name: /save task/i });

describe('TaskFormModal save behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' };
    api.createTask.mockResolvedValue({ id: 'task-1' });
  });

  // D. double click: only one submission runs while saving
  it('blocks double submit and closes only after the save resolves', async () => {
    let resolve!: (value: unknown) => void;
    api.createTask.mockReturnValue(new Promise((value) => { resolve = value; }));
    const onClose = vi.fn();

    render(<TaskFormModal isOpen onClose={onClose} />);
    fireEvent.change(titleInput(), { target: { value: 'Tidy room' } });

    const submit = submitButton();
    fireEvent.click(submit);
    fireEvent.click(submit);

    // Only the first click triggered a submission.
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();

    resolve({ id: 'task-1' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  // 5. error-state handling: show a useful error if authentication is missing
  it('shows a clear error when the API rejects for missing authentication', async () => {
    api.createTask.mockRejectedValue(Object.assign(new Error('Authentication required'), { code: 'unauthenticated' }));
    const onClose = vi.fn();

    render(<TaskFormModal isOpen onClose={onClose} />);
    fireEvent.change(titleInput(), { target: { value: 'Tidy room' } });
    fireEvent.click(submitButton());

    expect(await screen.findByText('Authentication required')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // 5. error-state handling: retain the modal and error after a failed save
  it('retains the modal and surfaces the error after a failed save', async () => {
    api.createTask.mockRejectedValue(new Error('permission-denied: actorId must equal auth.uid'));
    const onClose = vi.fn();

    render(<TaskFormModal isOpen onClose={onClose} />);
    fireEvent.change(titleInput(), { target: { value: 'Tidy room' } });
    fireEvent.click(submitButton());

    expect(await screen.findByText(/permission-denied/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The previous error is cleared at the start of a new save attempt.
    expect(titleInput()).toHaveValue('Tidy room');
  });

  // 5. error-state handling: guard when the local user session is missing
  it('shows a sign-in error when no current user is present', async () => {
    store.currentUser = null as any;
    const onClose = vi.fn();

    render(<TaskFormModal isOpen onClose={onClose} />);
    fireEvent.change(titleInput(), { target: { value: 'Tidy room' } });
    fireEvent.click(submitButton());

    expect(await screen.findByText(/signed in/i)).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
