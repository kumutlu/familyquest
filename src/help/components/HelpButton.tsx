import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { helpArticleForRoute, helpArticlePath } from '../helpRouteMap';
import type { HelpArticleId } from '../types';

interface Props {
  /** Overrides the route-derived article (rare; prefer the route map). */
  articleId?: HelpArticleId;
  className?: string;
  size?: number;
}

/**
 * Contextual "?" button.
 *
 * It never renders help copy itself — it always navigates to the canonical
 * Help article for the current page, so there is exactly one source of truth.
 *
 * The router hooks (`useNavigate`/`useLocation`) are only invoked inside a
 * Router context. Pages rendered by legacy unit tests without a Router simply
 * get `null` instead of a crash.
 */
export function HelpButton(props: Props) {
  if (!useInRouterContext()) return null;
  return <HelpButtonInner {...props} />;
}

function HelpButtonInner({ articleId, className, size = 18 }: Props) {
  const { t } = useTranslation('help');
  const navigate = useNavigate();
  const location = useLocation();

  const target = articleId ?? helpArticleForRoute(location.pathname);
  if (!target) return null;

  return (
    <button
      type="button"
      onClick={() => navigate(helpArticlePath(target, location.pathname))}
      aria-label={t('contextual.openHelp')}
      title={t('contextual.openHelp')}
      data-testid="help-button"
      data-help-article={target}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition',
        'hover:bg-gray-100 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        className
      )}
    >
      <HelpCircle size={size} aria-hidden />
    </button>
  );
}
