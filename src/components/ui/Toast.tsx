import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastData {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  duration?: number;
}

/**
 * Lightweight, accessible snackbar. Auto-dismisses and announces via
 * aria-live so screen readers are notified. Rendered above the bottom nav.
 */
export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  const { t } = useTranslation('common');
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;

  // Solid toast surfaces carry white text/icons, so the background must clear
  // WCAG AA (4.5:1) for the message. `success-500` (#22c55e) only reached
  // ~2.28:1; `success-700` (#15803d) reaches ~5.01:1 while keeping the green
  // success identity. The toast is a transient surface, not a control, so it
  // has no hover/active states.
  const tone = {
    success: 'bg-success-700',
    error: 'bg-danger-500',
    info: 'bg-gray-900',
  }[toast.type];

  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info;

  return (
    <div
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm px-2"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg text-white',
          tone,
        )}
      >
        <Icon size={18} className="shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium flex-1">{toast.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('dismissNotification')}
          className="shrink-0 rounded-md opacity-80 transition-opacity hover:opacity-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
