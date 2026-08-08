import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  XCircle,
  Gift,
  ArrowLeftRight,
  Plus,
  Minus,
  Smile,
  Frown,
  PawPrint,
  User,
  Inbox,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNotifications } from '../lib/useNotifications';
import {
  formatRelativeTime,
  toMillis,
  getNotificationTitle,
  getNotificationBody,
  type NotificationData,
  type NotificationType,
} from '../lib/notifications';
import { getNotificationRoute } from '../lib/notificationRoutes';
import { isPetBoxEnabled } from '../lib/familyFeatures';
import { cn } from '../lib/utils';

const ICONS: Record<NotificationType, LucideIcon> = {
  task_submitted: Inbox,
  task_approved: CheckCircle,
  task_rejected: XCircle,
  reward_requested: Gift,
  reward_approved: CheckCircle,
  reward_rejected: XCircle,
  transfer_requested: ArrowLeftRight,
  transfer_approved: ArrowLeftRight,
  transfer_rejected: XCircle,
  wallet_deposit: Plus,
  wallet_withdrawal: Minus,
  behaviour_positive: Smile,
  behaviour_negative: Frown,
  petbox_contribution: PawPrint,
  petbox_expense: PawPrint,
  profile_update_requested: User,
  profile_update_approved: CheckCircle,
  profile_update_rejected: XCircle,
};

function iconFor(type: NotificationType): LucideIcon {
  return ICONS[type] ?? Inbox;
}

function timeIso(value: unknown): string | undefined {
  const ms = toMillis(value);
  return ms ? new Date(ms).toISOString() : undefined;
}

type TabKey = 'all' | 'unread' | 'mentions';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'unread', label: 'unread' },
  { key: 'mentions', label: 'mentions' },
];

/**
 * Full-page notifications view reached from the "View all notifications" link
 * in the Notification Center. Reuses the same realtime data/store
 * (`useNotifications`) and the same row presentation as the center so there is
 * a single source of truth for notification content and read state.
 */
export function Notifications() {
  const { t } = useTranslation(['notifications', 'common']);
  const currentUser = useStore(state => state.currentUser);
  const familyId = currentUser?.familyId ?? null;
  const userId = currentUser?.id ?? null;

  const {
    notifications,
    readIds,
    unreadCount,
    error,
    loading,
    loadingMore,
    hasMore,
    markRead,
    markAllRead,
    loadMore,
    retry,
  } = useNotifications(familyId, userId);

  const [tab, setTab] = useState<TabKey>('all');
  const [readError, setReadError] = useState<string | null>(null);
  const navigate = useNavigate();
  const familyData = useStore(state => state.familyData);

  const filtered = useMemo(() => {
    if (tab === 'unread') {
      return notifications.filter(n => n && n.id && !readIds.has(n.id));
    }
    if (tab === 'mentions') {
      return notifications.filter(
        n => n && n.id && (n.actorId === userId || (n.recipientIds?.length ?? 0) === 1),
      );
    }
    return notifications;
  }, [notifications, readIds, tab, userId]);

  const handleRowClick = useCallback(
    async (n: NotificationData) => {
      const target = getNotificationRoute(n.type, n.actionUrl, isPetBoxEnabled(familyData));
      try {
        await markRead(n.id);
      } catch (e) {
        setReadError((e as Error)?.message || t('readError'));
      }
      try {
        navigate(target);
      } catch {
        navigate('/');
      }
    },
    [markRead, navigate, familyData, t],
  );

  const handleMarkAll = useCallback(async () => {
    try {
      await markAllRead();
      setReadError(null);
    } catch (e) {
      setReadError((e as Error)?.message || t('readError'));
    }
  }, [markAllRead]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2 px-1 py-3">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-extrabold text-gray-900">{t('title')}</h1>
          <HelpButton />
        </div>
        <button
          type="button"
          onClick={handleMarkAll}
          disabled={unreadCount === 0}
          className="text-sm font-semibold text-primary-600 hover:text-primary-700 disabled:text-gray-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {t('markAllRead')}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Notification filters"
        className="flex gap-1 px-1 pb-2 border-b border-gray-100 overflow-x-auto [-webkit-overflow-scrolling:touch]"
      >
        {TABS.map(tabItem => {
          const selected = tab === tabItem.key;
          const count =
            tabItem.key === 'unread'
              ? unreadCount
              : tabItem.key === 'mentions'
                ? notifications.filter(
                    n => n.actorId === userId || (n.recipientIds?.length ?? 0) === 1,
                  ).length
                : notifications.length;
          return (
            <button
              key={tabItem.key}
              role="tab"
              type="button"
              id={`notif-page-tab-${tabItem.key}`}
              aria-selected={selected}
              aria-controls="notif-page-tabpanel"
              onClick={() => setTab(tabItem.key)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                selected
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {t(`tabs.${tabItem.key}`)}
              {count > 0 && (
                <span className={cn('ml-1', selected ? 'text-white/80' : 'text-gray-400')}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {readError && (
        <div role="alert" className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
          {readError}
        </div>
      )}

      <div
        id="notif-page-tabpanel"
        role="tabpanel"
        aria-labelledby={`notif-page-tab-${tab}`}
      >
        {error ? (
          <div className="p-8 text-center">
            <AlertTriangle size={28} className="mx-auto text-red-400 mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold text-gray-700">{t('errorTitle')}</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 text-xs font-semibold text-primary-600 hover:text-primary-700 px-3 py-1.5 rounded-lg border border-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('common:retry')}
            </button>
          </div>
        ) : loading ? (
          <ul className="divide-y divide-gray-100" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex gap-3 p-4 animate-pulse">
                <span className="mt-0.5 shrink-0 w-[18px] h-[18px] rounded-full bg-gray-200" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/2 rounded bg-gray-200" />
                  <span className="block h-2.5 w-3/4 rounded bg-gray-100" />
                  <span className="block h-2 w-16 rounded bg-gray-100" />
                </span>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Inbox size={32} className="mx-auto text-gray-300 mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold text-gray-700">{t('emptyYet')}</p>
            <p className="text-xs text-gray-400 mt-1">
              {tab === 'unread'
                ? t('emptyUnread')
                : tab === 'mentions'
                  ? t('emptyMentions')
                  : t('emptyDefault')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map(n => {
              const Icon = iconFor(n.type as NotificationType);
              const isUnread = !readIds.has(n.id);
              const title = getNotificationTitle(n);
              const body = getNotificationBody(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleRowClick(n)}
                    aria-label={`${title}. ${body}.${isUnread ? ` ${t('unread')}.` : ''}`}
                    className={cn(
                      'w-full text-left flex gap-3 p-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                      isUnread ? 'bg-primary-50/50' : 'bg-white',
                    )}
                  >
                    <span
                      className={cn('mt-0.5 shrink-0', isUnread ? 'text-primary-600' : 'text-gray-400')}
                      aria-hidden="true"
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-sm truncate',
                            isUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-700',
                          )}
                        >
                          {title}
                        </span>
                        {isUnread && (
                          <span
                            className="shrink-0 w-2 h-2 rounded-full bg-primary-500"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">{body}</span>
                      <time dateTime={timeIso(n.createdAt)} className="block text-[10px] text-gray-400 mt-1">
                        {formatRelativeTime(n.createdAt)}
                        {isUnread && <span className="sr-only"> ({t('unread')})</span>}
                      </time>
                    </span>
                    {isUnread && <span className="sr-only">{t('unread')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!error && !loading && hasMore && filtered.length > 0 && (
          <div className="p-3 border-t border-gray-100">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full text-center text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:text-gray-300 py-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {loadingMore ? t('common:loading') : t('loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Notifications;
