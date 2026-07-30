import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export interface PageLoaderProps {
  /** Visible label. Defaults to the shared common:loading string. */
  label?: string;
  /** Fill the viewport (used for route/bootstrap level loading). */
  fullScreen?: boolean;
  className?: string;
}

/**
 * Single, consistent loading indicator for page and section level waits.
 *
 * Every screen previously rolled its own `animate-pulse` text block, which
 * produced different paddings, different wording and no screen-reader
 * announcement. This keeps spinner size, spacing and semantics identical
 * everywhere.
 */
export function PageLoader({ label, fullScreen = false, className }: PageLoaderProps) {
  const { t } = useTranslation('common');
  const text = label ?? t('loading');

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-gray-500',
        fullScreen ? 'min-h-screen bg-gray-50 p-4' : 'py-12 px-4',
        className,
      )}
    >
      <Loader2 size={24} className="animate-spin text-primary-500" aria-hidden="true" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
