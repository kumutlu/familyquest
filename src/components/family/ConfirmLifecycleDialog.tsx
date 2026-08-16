import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';

interface ConfirmLifecycleDialogProps {
  open: boolean;
  title: string;
  /** Explanatory body text describing exactly what will happen. */
  message: string;
  confirmLabel: string;
  /** Stronger visual treatment for destructive/irreversible actions. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Deliberate, two-step confirmation for member lifecycle actions. Every
 * archive / remove / delete / transfer must pass through here so it can never
 * be triggered by a single accidental click.
 */
export function ConfirmLifecycleDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: ConfirmLifecycleDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifecycle-confirm-title"
        className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 outline-none"
      >
        <div className="px-6 pt-5 pb-2 flex items-center gap-2">
          {danger && <AlertTriangle className="h-5 w-5 text-red-500" />}
          <h3 id="lifecycle-confirm-title" className="text-lg font-bold text-gray-900">{title}</h3>
        </div>
        <div className="px-6 pb-4">
          <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}
          >
            {busy ? '…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
