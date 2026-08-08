import React, { useEffect, useRef } from 'react';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Optional custom header node. When omitted, a default header with `title`
   * and a close button is rendered. Must be `shrink-0` so it never scrolls.
   */
  header?: React.ReactNode;
  /**
   * Scrollable body content. Rendered inside a `flex-1 min-h-0 overflow-y-auto`
   * region so it can scroll independently of the header/footer on any viewport.
   */
  children: React.ReactNode;
  /**
   * Sticky footer (actions). Rendered outside the scroll region so it is always
   * reachable, with safe-area padding for notched iPhones.
   */
  footer?: React.ReactNode;
  /** z-index of the overlay. Must sit above the bottom navigation (z-40). */
  zIndex?: number;
  /** Disable the body scroll lock (e.g. for nested modals). */
  lockScroll?: boolean;
  /** Prevent Escape, backdrop, and the default close button from dismissing. */
  preventClose?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  header,
  children,
  footer,
  zIndex = 50,
  lockScroll = true,
  preventClose = false,
}: ModalProps) {
  const { t } = useTranslation('common');
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const openingFocus = useRef<HTMLElement | null>(null);
  // Capture the opener during the closed -> open render, before React commits
  // descendants and applies any deliberate autoFocus field.
  if (isOpen && !wasOpen.current) {
    openingFocus.current = typeof document === 'undefined'
      ? null
      : document.activeElement as HTMLElement | null;
  }
  wasOpen.current = isOpen;
  const titleId = title ? 'modal-title' : undefined;
  // Keep the latest onClose without making it an effect dependency. Passing a
  // new inline onClose every render (common in callers) previously re-ran this
  // effect on EVERY render, and its cleanup called .focus() on a captured
  // element -- stealing focus from the field being typed in (e.g. the Create
  // Goal form's Fixed amount / Percentage inputs jumped back to Title).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const preventCloseRef = useRef(preventClose);
  preventCloseRef.current = preventClose;
  const requestClose = () => {
    if (!preventCloseRef.current) onCloseRef.current();
  };

  useBodyScrollLock(isOpen && lockScroll);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = openingFocus.current;
    if (!dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Return focus to the trigger for accessibility, but ONLY when the modal
      // is actually closing (isOpen transitioned to false) -- never on every
      // re-render, which would yank focus away from an open form.
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Dialog: flex column, bounded dynamic viewport height, overflow hidden */}
      <div
        data-testid="modal-panel"
        className="relative bg-white w-full sm:max-w-md flex flex-col max-h-[90dvh] sm:max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-xl animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
      >
        {/* Header (shrink-0) */}
        {header ?? (
          <div className="shrink-0 px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            {title && <h3 id={titleId} className="text-lg font-bold text-gray-900">{title}</h3>}
            <button
              onClick={requestClose}
              aria-disabled={preventClose}
              aria-label={t('closeDialog')}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors ml-auto"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Scrollable content (flex-1 min-h-0 overflow-y-auto) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] p-6">
          {children}
        </div>

        {/* Footer (shrink-0, sticky bottom, safe-area padding) */}
        {footer && (
          <div className="shrink-0 sticky bottom-0 bg-white border-t border-gray-100 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
