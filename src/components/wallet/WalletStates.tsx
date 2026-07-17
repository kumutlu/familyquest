import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 p-8 text-center">
      {icon && (
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="font-semibold text-gray-900">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

// Friendly, non-technical error. Raw Firebase error text must never be passed here.
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl bg-white border border-gray-100 p-6 text-center"
    >
      <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-danger-50 text-danger-500 flex items-center justify-center">
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <p className="font-semibold text-gray-900">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

export function TransactionSkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-gray-50" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-100 animate-pulse" />
            <div className="space-y-2">
              <div className="h-3 w-32 rounded bg-gray-100 animate-pulse" />
              <div className="h-2 w-20 rounded bg-gray-100 animate-pulse" />
            </div>
          </div>
          <div className="h-4 w-16 rounded bg-gray-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export { Inbox };
