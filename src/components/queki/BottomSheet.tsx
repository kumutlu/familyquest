import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { QUEKI_MOTION, useReducedMotion } from '../../design/motion';
import { IconButton } from './IconButton';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  'aria-label': string;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Queki v2 bottom sheet — a focus-trapping modal dialog that slides up from
 * the bottom edge on mobile and centres as a raised card on desktop.
 * Uses a native <dialog>-like pattern with role="dialog", aria-modal, Escape
 * handling and scrim click-to-close. Animations collapse under reduced motion.
 */
export function BottomSheet({ open, onClose, 'aria-label': ariaLabel, title, children, className }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the sheet for keyboard users.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
        style={{
          animation: reducedMotion ? undefined : `qk-fade-in var(--animate-duration-exit) ease both`,
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg rounded-t-sheet sm:rounded-card qk-bg-raised qk-shadow-card',
          'max-h-[85dvh] overflow-y-auto outline-none',
          'pb-[calc(1rem+env(safe-area-inset-bottom))]',
          className,
        )}
        style={{
          animation: reducedMotion
            ? undefined
            : `qk-sheet-up var(--animate-duration-sheet) var(--ease-sheet) both`,
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 qk-bg-raised px-5 pb-3 pt-4">
          <div aria-hidden="true" className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-black/10 dark:bg-white/20 sm:hidden" />
          {title != null && <h2 className="text-card-title qk-text-primary">{title}</h2>}
          <IconButton aria-label="Close" onClick={onClose} className="ml-auto">
            <X size={20} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="px-5 pb-2">{children}</div>
      </div>

      <style>{`
        @keyframes qk-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes qk-sheet-up {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  );
}

// Re-exported so imperative callers share one source of truth for timing.
export const SHEET_DURATION_MS = QUEKI_MOTION.duration.sheet;
