import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { getQuekiNavItems } from '../../config/navigation';
import { RoleAwareActionButton } from './RoleAwareAction';

export interface QuekiBottomNavigationProps {
  /** Current user role; drives the centre Action button. */
  role: string | undefined | null;
  /** Called when the centre Action button is pressed (opens the composer). */
  onActionPress: () => void;
}

/**
 * Queki v2 bottom navigation — touch-first, safe-area aware, with the visually
 * dominant role-aware centre Action button. Desktop keeps the header nav; this
 * component renders on all sizes but is hidden below `md` by its parent.
 *
 * Selected state is always obvious (filled pill + bold label), never colour-only.
 */
export function QuekiBottomNavigation({ role, onActionPress }: QuekiBottomNavigationProps) {
  const { t } = useTranslation('common');
  const location = useLocation();
  const items = getQuekiNavItems();
  const [left, right] = [items.slice(0, 2), items.slice(2)];

  const renderItem = (item: ReturnType<typeof getQuekiNavItems>[number]) => {
    const isActive = location.pathname === item.path;
    const IconComp = item.icon as React.ComponentType<{ size?: number; strokeWidth?: number }>;
    return (
      <Link
        key={item.path}
        to={item.path}
        data-testid={item.testId}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 transition-colors duration-[var(--animate-duration-tap)] ease-tap',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          isActive ? 'text-primary-600 dark:text-primary-300' : 'qk-text-secondary hover:text-primary-500',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
            isActive && 'bg-primary-50 dark:bg-primary-100',
          )}
        >
          <IconComp size={22} strokeWidth={isActive ? 2.6 : 2} />
        </span>
        <span className={cn('text-[11px]', isActive ? 'font-bold' : 'font-medium')}>
          {t(item.labelKey)}
        </span>
      </Link>
    );
  };

  return (
    <nav
      data-testid="queki-bottom-nav"
      aria-label={t('nav.primary', { defaultValue: 'Primary' })}
      className="fixed inset-x-0 bottom-0 z-40 md:hidden pb-[env(safe-area-inset-bottom)]"
      style={{
        // Own compositing layer so it never nests inside transformed ancestors.
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <div
        className="border-t qk-border-subtle qk-bg-card"
        style={{ boxShadow: '0 -8px 24px -16px rgba(23,21,31,0.25)' }}
      >
        <div className="mx-auto flex max-w-lg items-end justify-around px-2">
          {left.map(renderItem)}
          <div className="flex w-20 justify-center">
            <RoleAwareActionButton role={role} onPress={onActionPress} />
          </div>
          {right.map(renderItem)}
        </div>
      </div>
    </nav>
  );
}
