import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CheckCircle2, Edit, Trash2 } from 'lucide-react';
import { isParentRole } from '../../lib/roles';

interface TaskDetailsModalProps {
  task: any;
  currentUserRole?: string;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onEdit: (task: any) => void;
  onArchive: (taskId: string) => void;
  onComplete: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Task Details modal.
 *
 * Mobile: renders as a bottom sheet (anchored to the bottom, max-height 90dvh)
 * with a three-part layout: a sticky header, a scrollable content area, and a
 * sticky action footer (Edit / Archive) that always stays visible.
 *
 * Desktop: remains a compact, centred dialog (sm:items-center, sm:max-w-md).
 *
 * Accessibility: role="dialog", aria-modal, labelled by the heading, Escape
 * closes, focus is trapped inside, and focus returns to the trigger on close.
 */
export function TaskDetailsModal({
  task,
  currentUserRole,
  isSubmitting = false,
  error = null,
  onClose,
  onEdit,
  onArchive,
  onComplete,
}: TaskDetailsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const { t } = useTranslation('tasks');
  const isParent = isParentRole(currentUserRole);

  // Lock background scroll, capture the trigger element, move focus into the
  // dialog, and restore everything when the modal closes.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // Escape closes the dialog; Tab is trapped within it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );

        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey && (active === first || active === dialogRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="task-details-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        tabIndex={-1}
        data-testid="task-details-dialog"
        className="bg-white w-full sm:w-auto sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300 overflow-hidden flex flex-col max-h-[90dvh] outline-none"
      >
        {/* Header — fixed/sticky at the top, always visible */}
        <header
          data-testid="task-details-header"
          className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white"
        >
          <h3 id="task-details-title" className="text-xl font-bold text-gray-900">
            {t('details.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('details.closeAria')}
            className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
          >
            ✕
          </button>
        </header>

        {/* Scrollable content — only this area scrolls */}
        <div
          data-testid="task-details-content"
          className="min-h-0 flex-1 overflow-y-auto p-6"
        >
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center text-primary-500">
              <CheckCircle2 size={40} />
            </div>

            <div>
              <h4 className="text-2xl font-bold text-gray-900">{task.title}</h4>
              <p className="text-gray-500 font-medium mt-1">
                {t('details.reward', { points: task.pointsReward })}
              </p>
            </div>

            <div className="flex gap-2">
              <Badge variant="default">{task.type}</Badge>
              {task.requiresApproval && (
                <Badge variant="warning">{t('details.requiresApproval')}</Badge>
              )}
            </div>

            {error && (
              <p className="text-danger-500 text-sm font-medium">{error}</p>
            )}

            {/* Child completion action stays in the scrollable content */}
            {!isParent &&
              task.available &&
              (task.status === 'pending' || task.status === 'rejected') && (
                <Button
                  fullWidth
                  onClick={onComplete}
                  size="lg"
                  disabled={isSubmitting}
                  className="shadow-primary-500/25 mt-6"
                >
                  {isSubmitting ? t('details.submitting') : t('details.markDone')}
                </Button>
              )}
            {!isParent && !task.available && task.status === 'not_eligible' && (
              <div className="mt-6 p-4 bg-gray-50 rounded-xl w-full">
                <p className="text-gray-500 font-medium">{t('details.notAvailableToday')}</p>
              </div>
            )}
            {!isParent &&
              task.status !== 'pending' &&
              task.status !== 'rejected' &&
              task.status !== 'not_eligible' && (
                <div className="mt-6 p-4 bg-gray-50 rounded-xl w-full">
                  <p className="text-gray-500 font-medium">
                    {task.status === 'approved'
                      ? t('details.completedApproved')
                      : t('details.waitingParent')}
                  </p>
                </div>
              )}
          </div>
        </div>

        {/* Action footer — fixed/sticky at the bottom, always visible (parent only) */}
        {isParent && (
          <footer
            data-testid="task-details-footer"
            className="shrink-0 sticky bottom-0 bg-white border-t border-gray-100 px-6 pt-4 flex gap-4"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <Button variant="secondary" fullWidth onClick={() => onEdit(task)}>
              <Edit size={16} className="mr-2" /> {t('details.edit')}
            </Button>
            <Button variant="danger" fullWidth onClick={() => onArchive(task.id)}>
              <Trash2 size={16} className="mr-2" /> {t('details.archive')}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
