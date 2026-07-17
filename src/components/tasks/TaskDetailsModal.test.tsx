import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';

import { TaskDetailsModal } from './TaskDetailsModal';

const baseTask = {
  id: 'task-1',
  title: 'Make the bed',
  pointsReward: 10,
  type: 'daily',
  requiresApproval: true,
  status: 'pending',
};

function renderModal(props: any = {}) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  const onArchive = vi.fn();
  const onComplete = vi.fn();

  const utils = render(
    <TaskDetailsModal
      task={baseTask}
      currentUserRole="parent"
      onClose={onClose}
      onEdit={onEdit}
      onArchive={onArchive}
      onComplete={onComplete}
      {...props}
    />
  );

  return { onClose, onEdit, onArchive, onComplete, ...utils };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
});

describe('TaskDetailsModal — mobile bottom-sheet & desktop behaviour', () => {
  it('1. uses a bottom-sheet layout on mobile (anchored to the bottom)', () => {
    const { getByTestId } = renderModal();
    const overlay = getByTestId('task-details-overlay');
    expect(overlay.className).toContain('items-end');
    expect(overlay.className).toContain('justify-center');
  });

  it('2. has a max-height based on the viewport (90dvh)', () => {
    const { getByTestId } = renderModal();
    const dialog = getByTestId('task-details-dialog');
    expect(dialog.className).toContain('max-h-[90dvh]');
  });

  it('3. has a scrollable content area (min-h-0, flex-1, overflow-y-auto)', () => {
    const { getByTestId } = renderModal();
    const content = getByTestId('task-details-content');
    expect(content.className).toContain('min-h-0');
    expect(content.className).toContain('flex-1');
    expect(content.className).toContain('overflow-y-auto');
  });

  it('4. keeps the header visible (shrink-0) with the Task Details title', () => {
    const { getByTestId, getByText } = renderModal();
    const header = getByTestId('task-details-header');
    expect(header.className).toContain('shrink-0');
    expect(getByText('Task Details')).toBeInTheDocument();
  });

  it('5. keeps the Edit/Archive footer visible (sticky bottom-0)', () => {
    const { getByTestId, getByRole } = renderModal();
    const footer = getByTestId('task-details-footer');
    expect(footer.className).toContain('sticky');
    expect(footer.className).toContain('bottom-0');
    expect(getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /archive/i })).toBeInTheDocument();
  });

  it('6. applies iPhone safe-area padding to the footer', () => {
    const { getByTestId } = renderModal();
    const footer = getByTestId('task-details-footer') as HTMLElement;
    expect(footer.style.paddingBottom).toContain('env(safe-area-inset-bottom)');
  });

  it('7. remains centred on desktop (sm:items-center, sm:max-w-md, sm:rounded-3xl)', () => {
    const { getByTestId } = renderModal();
    const overlay = getByTestId('task-details-overlay');
    const dialog = getByTestId('task-details-dialog');
    expect(overlay.className).toContain('sm:items-center');
    expect(dialog.className).toContain('sm:max-w-md');
    expect(dialog.className).toContain('sm:rounded-3xl');
  });

  it('8. locks background scroll while open and restores it on close', () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('9. returns focus to the triggering task card on close', () => {
    const TriggerWrapper = ({ show }: { show: boolean }) => (
      <>
        <button data-testid="trigger" type="button">
          Open
        </button>
        {show && (
          <TaskDetailsModal
            task={baseTask}
            currentUserRole="parent"
            onClose={() => {}}
            onEdit={vi.fn()}
            onArchive={vi.fn()}
            onComplete={vi.fn()}
          />
        )}
      </>
    );

    const { rerender } = render(<TriggerWrapper show={false} />);
    const trigger = screen.getByTestId('trigger') as HTMLButtonElement;

    trigger.focus();
    expect(trigger).toHaveFocus();

    rerender(<TriggerWrapper show={true} />);
    // Focus is moved into the dialog while it is open.
    expect(screen.getByTestId('task-details-dialog')).toHaveFocus();

    rerender(<TriggerWrapper show={false} />);
    // Focus returns to the trigger (task card) after closing.
    expect(trigger).toHaveFocus();
  });

  it('10. Edit and Archive actions still invoke the existing handlers', () => {
    const { getByRole, onEdit, onArchive } = renderModal();
    fireEvent.click(getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(baseTask);

    fireEvent.click(getByRole('button', { name: /archive/i }));
    expect(onArchive).toHaveBeenCalledWith('task-1');
  });
});

describe('TaskDetailsModal — accessibility extras', () => {
  it('exposes dialog semantics (role, aria-modal, labelledby) and closes on Escape', () => {
    const { getByTestId, onClose } = renderModal();
    const dialog = getByTestId('task-details-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'task-details-title');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render the parent footer for a child user', () => {
    const { queryByTestId } = renderModal({ currentUserRole: 'child' });
    expect(queryByTestId('task-details-footer')).not.toBeInTheDocument();
  });
});
