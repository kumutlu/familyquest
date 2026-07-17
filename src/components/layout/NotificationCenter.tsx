import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  X,
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
import { useStore } from '../../store/useStore';
import { useNotifications } from '../../lib/useNotifications';
import { useBodyScrollLock } from '../../lib/useBodyScrollLock';
import {
  formatRelativeTime,
  toMillis,
  getNotificationTitle,
  getNotificationBody,
  type NotificationData,
  type NotificationType,
} from '../../lib/notifications';
import { getNotificationRoute } from '../../lib/notificationRoutes';
import { cn } from '../../lib/utils';

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
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

// Drag-to-close tuning.
const DRAG_CLOSE_THRESHOLD = 120; // px the sheet must be dragged down to close
const DRAG_VELOCITY_THRESHOLD = 0.6; // px/ms flick velocity to close

export function NotificationCenter() {
  const currentUser = useStore(state => state.currentUser);
  const familyId = currentUser?.familyId ?? null;
  const userId = currentUser?.uid ?? null;

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

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [readError, setReadError] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const dragState = useRef<{ startY: number; startT: number } | null>(null);
  const navigate = useNavigate();

  // Lock background scroll while the sheet is open (mobile + desktop).
  useBodyScrollLock(open);

  const close = useCallback(() => {
    setOpen(false);
    setReadError(null);
    setDragOffset(0);
    setDragging(false);
    requestAnimationFrame(() => previouslyFocused.current?.focus());
  }, []);

  const toggle = useCallback(() => {
    if (!open) {
      previouslyFocused.current = bellRef.current;
    }
    setOpen(o => !o);
  }, [open]);

  const handleRowClick = useCallback(
    async (n: NotificationData) => {
      const target = getNotificationRoute(n.type, n.actionUrl);
      try {
        await markRead(n.id);
      } catch (e) {
        setReadError((e as Error)?.message || "We couldn't update this notification.");
      }
      close();
      try {
        navigate(target);
      } catch {
        navigate('/');
      }
    },
    [markRead, navigate, close],
  );

  const handleMarkAll = useCallback(async () => {
    try {
      await markAllRead();
      setReadError(null);
    } catch (e) {
      setReadError((e as Error)?.message || "We couldn't update this notification.");
    }
  }, [markAllRead]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Close on outside click (desktop) — the mobile sheet uses its own backdrop.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Focus trap: keep Tab within the sheet while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && (active === first || active === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Filter notifications by the active tab.
  const filtered = useMemo(() => {
    if (tab === 'unread') {
      return notifications.filter(n => n && n.id && !readIds.has(n.id));
    }
    if (tab === 'mentions') {
      // "Mentions" = notifications where the current user is an explicit actor
      // or the notification references them (recipient-only, not broadcast).
      return notifications.filter(
        n => n && n.id && (n.actorId === userId || (n.recipientIds?.length ?? 0) === 1),
      );
    }
    return notifications;
  }, [notifications, readIds, tab, userId]);

  // Drag-to-close handlers (pointer events cover touch + mouse).
  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragState.current = { startY: e.clientY, startT: performance.now() };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const delta = e.clientY - dragState.current.startY;
    // Only allow dragging downward; upward drag is ignored (rubber-band feel).
    setDragOffset(delta > 0 ? delta : 0);
  }, []);

  const onDragEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) {
        setDragging(false);
        return;
      }
      const delta = e.clientY - dragState.current.startY;
      const elapsed = Math.max(1, performance.now() - dragState.current.startT);
      const velocity = delta / elapsed;
      const shouldClose =
        delta > DRAG_CLOSE_THRESHOLD || velocity > DRAG_VELOCITY_THRESHOLD;
      dragState.current = null;
      setDragging(false);
      if (shouldClose) {
        close();
      } else {
        setDragOffset(0);
      }
    },
    [close],
  );

  const badge = unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;
  const ariaLabel = `Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`;

  const sheetStyle: React.CSSProperties = dragging
    ? { transform: `translateY(${dragOffset}px)`, transition: 'none' }
    : { transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)' };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={bellRef}
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Bell size={24} aria-hidden="true" />
        {badge && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[11px] font-bold text-white bg-primary-500 rounded-full border border-white"
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/30 z-40"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            tabIndex={-1}
            style={sheetStyle}
            className={cn(
              'z-50 bg-white shadow-xl border border-gray-100 flex flex-col outline-none',
              // Mobile: bottom sheet, 88vh, rounded top corners, safe-area padding.
              'fixed bottom-0 left-0 right-0 max-h-[88vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
              // Desktop: anchored dropdown.
              'md:absolute md:top-full md:right-0 md:mt-2 md:w-96 md:max-h-[32rem] md:rounded-2xl md:bottom-auto md:pb-0',
            )}
          >
            {/* Drag handle + header (sticky top, fixed height) */}
            <div
              className="sticky top-0 z-10 shrink-0 flex flex-col bg-white rounded-t-2xl border-b border-gray-100"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              {/* Drag handle — visible on mobile, hidden on desktop dropdown */}
              <div className="md:hidden flex justify-center pt-2 pb-1" aria-hidden="true">
                <span className="h-1.5 w-10 rounded-full bg-gray-300" />
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <h2 className="font-bold text-gray-900 text-sm">Notifications</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleMarkAll}
                    disabled={unreadCount === 0}
                    className="text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:text-gray-300 disabled:cursor-not-allowed px-2 py-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    Mark all as read
                  </button>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    aria-label="Close notifications"
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* Tabs (fixed height, sibling of scrollable content) */}
            <div
              role="tablist"
              aria-label="Notification filters"
              className="shrink-0 flex gap-1 px-4 pb-2 pt-2 border-b border-gray-100 overflow-x-auto [-webkit-overflow-scrolling:touch]"
            >
              {TABS.map(t => {
                const selected = tab === t.key;
                const count =
                  t.key === 'unread'
                    ? unreadCount
                    : t.key === 'mentions'
                      ? notifications.filter(
                          n => n.actorId === userId || (n.recipientIds?.length ?? 0) === 1,
                        ).length
                      : notifications.length;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    id={`notif-tab-${t.key}`}
                    aria-selected={selected}
                    aria-controls="notif-tabpanel"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      selected
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    {t.label}
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

            {/* Scrollable content area (tabs + list) */}
            <div
              id="notif-tabpanel"
              role="tabpanel"
              aria-labelledby={`notif-tab-${tab}`}
              className="overflow-y-auto flex-1 min-h-0 overscroll-contain [-webkit-overflow-scrolling:touch]"
            >
              {error ? (
                <div className="p-8 text-center">
                  <AlertTriangle size={28} className="mx-auto text-red-400 mb-2" aria-hidden="true" />
                  <p className="text-sm font-semibold text-gray-700">Couldn't load notifications</p>
                  <p className="text-xs text-gray-400 mt-1">{error}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-3 text-xs font-semibold text-primary-600 hover:text-primary-700 px-3 py-1.5 rounded-lg border border-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    Retry
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
                  <p className="text-sm font-semibold text-gray-700">No notifications yet.</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {tab === 'unread'
                      ? 'You are all caught up.'
                      : tab === 'mentions'
                        ? 'Nothing mentions you right now.'
                        : 'We will let you know when something happens.'}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filtered.map(n => {
                    const Icon = iconFor(n.type);
                    const isUnread = !readIds.has(n.id);
                    const title = getNotificationTitle(n);
                    const body = getNotificationBody(n);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => handleRowClick(n)}
                          aria-label={`${title}. ${body}.${isUnread ? ' Unread.' : ''}`}
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
                              {isUnread && <span className="sr-only"> (unread)</span>}
                            </time>
                          </span>
                          {isUnread && <span className="sr-only">Unread</span>}
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
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>

            {/* Footer link */}
            <div className="shrink-0 border-t border-gray-100 px-4 py-3 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  close();
                  navigate('/notifications');
                }}
                className="text-xs font-semibold text-primary-600 hover:text-primary-700 py-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                View all notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
