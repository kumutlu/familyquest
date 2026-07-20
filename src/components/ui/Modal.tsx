import React, { useEffect, useRef } from 'react';

import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';

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
}: ModalProps) {
  const { t } = useTranslation('common');
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = title ? 'modal-title' : undefined;
  // Keep the latest onClose without making it an effect dependency. Passing a
  // new inline onClose every render (common in callers) previously re-ran this
  // effect on EVERY render, and its cleanup called .focus() on a captured
  // element -- stealing focus from the field being typed in (e.g. the Create
  // Goal form's Fixed amount / Percentage inputs jumped back to Title).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useBodyScrollLock(isOpen && lockScroll);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
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
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog: flex column, bounded dynamic viewport height, overflow hidden */}
      <div className="relative bg-white w-full sm:max-w-md flex flex-col max-h-[90dvh] sm:max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header (shrink-0) */}
        {header ?? (
          <div className="shrink-0 px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            {title && <h3 id={titleId} className="text-lg font-bold text-gray-900">{title}</h3>}
            <button
              onClick={onClose}
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
