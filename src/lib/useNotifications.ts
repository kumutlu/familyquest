import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
  subscribeToReadStates,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_LOAD_ERROR,
  mapNotificationError,
  type NotificationData,
} from './notifications';

export type NotificationConnectionState = 'connecting' | 'connected' | 'unavailable';

export interface UseNotificationsResult {
  notifications: NotificationData[];
  readIds: Set<string>;
  unreadCount: number;
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Realtime listener health. Only 'connected' once the listener has initialized. */
  connectionState: NotificationConnectionState;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Re-subscribes the realtime listeners. Safe to call from an error state. */
  retry: () => void;
}

/**
 * Encapsulates the realtime notification + read-state listeners and the
 * derived unread count. The latest-20 listener is bounded; older items are
 * fetched on demand via `loadMore`. Opening the panel never marks anything
 * read — that only happens on explicit user action.
 */
export function useNotifications(
  familyId: string | null | undefined,
  userId: string | null | undefined,
): UseNotificationsResult {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [connectionState, setConnectionState] = useState<NotificationConnectionState>('connecting');
  const [retryNonce, setRetryNonce] = useState(0);
  const cursorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!familyId || !userId) {
      setNotifications([]);
      setReadIds(new Set());
      setLoading(false);
      setError(null);
      setConnectionState('unavailable');
      return;
    }
    setLoading(true);
    setError(null);
    setConnectionState('connecting');
    cursorRef.current = null;

    const onNotif = (list: NotificationData[]) => {
      const map = new Map<string, NotificationData>();
      for (const n of list) {
        if (n && n.id) map.set(n.id, n);
      }
      setNotifications(Array.from(map.values()));
      setHasMore(list.length >= NOTIFICATION_PAGE_SIZE);
      if (list.length) cursorRef.current = list[list.length - 1].createdAt;
      setLoading(false);
      setConnectionState('connected');
    };
    const onNotifErr = (e: unknown) => {
      setError(mapNotificationError(e));
      setLoading(false);
      setConnectionState('unavailable');
    };
    const onRead = (ids: Set<string>) => setReadIds(ids);

    const unsubN = subscribeToNotifications(familyId, userId, { onNext: onNotif, onError: onNotifErr });
    const unsubR = subscribeToReadStates(familyId, userId, { onNext: onRead, onError: () => {} });
    return () => {
      unsubN();
      unsubR();
    };
  }, [familyId, userId, retryNonce]);

  const retry = useCallback(() => {
    setRetryNonce(n => n + 1);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter(n => n && n.id && !readIds.has(n.id)).length,
    [notifications, readIds],
  );

  const markRead = useCallback(
    async (id: string) => {
      if (!familyId || !userId) return;
      try {
        await markNotificationRead(familyId, userId, id);
      } catch (e) {
        throw new Error(mapNotificationError(e));
      }
    },
    [familyId, userId],
  );

  const markAllRead = useCallback(async () => {
    if (!familyId || !userId) return;
    try {
      const all = await fetchNotificationsPage(familyId, userId, { pageSize: 1000 });
      await markAllNotificationsRead(
        familyId,
        userId,
        all.map(n => n.id),
        readIds,
      );
    } catch (e) {
      throw new Error(mapNotificationError(e));
    }
  }, [familyId, userId, readIds]);

  const loadMore = useCallback(async () => {
    if (!familyId || !userId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotificationsPage(familyId, userId, {
        pageSize: NOTIFICATION_PAGE_SIZE,
        startAfter: cursorRef.current,
      });
      setNotifications(prev => {
        const map = new Map(prev.map(n => [n.id, n]));
        for (const n of page) {
          if (n && n.id && !map.has(n.id)) map.set(n.id, n);
        }
        return Array.from(map.values());
      });
      setHasMore(page.length >= NOTIFICATION_PAGE_SIZE);
      if (page.length) cursorRef.current = page[page.length - 1].createdAt;
    } catch {
      setError(NOTIFICATION_LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }, [familyId, userId, loadingMore, hasMore]);

  return {
    notifications,
    readIds,
    unreadCount,
    error,
    loading,
    loadingMore,
    hasMore,
    connectionState,
    markRead,
    markAllRead,
    loadMore,
    retry,
  };
}
