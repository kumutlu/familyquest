import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

const subState = vi.hoisted(() => ({
  activeCount: 0,
  notifCallbacks: null as null | { onNext: (l: any[]) => void; onError: (e: any) => void },
  readCallbacks: null as null | { onNext: (s: any) => void; onError: (e: any) => void },
  notifOptions: null as any,
  subscribeCalls: [] as any[],
  fetchPage: vi.fn(async () => [] as any[]),
  markRead: vi.fn(async () => {}),
  markAll: vi.fn(async () => {}),
}));

vi.mock('../lib/notifications', () => ({
  NOTIFICATION_PAGE_SIZE: 20,
  NOTIFICATION_LOAD_ERROR: "We couldn't load notifications. Please try again.",
  mapNotificationError: (e: any) =>
    e?.code ? `mapped:${e.code}` : "We couldn't load notifications. Please try again.",
  subscribeToNotifications: (familyId: string | null, userId: string | null, opts: any) => {
    subState.activeCount += 1;
    subState.notifOptions = opts;
    subState.subscribeCalls.push({ kind: 'notif', familyId, userId });
    subState.notifCallbacks = { onNext: opts.onNext, onError: opts.onError };
    return () => {
      subState.activeCount -= 1;
      subState.notifCallbacks = null;
    };
  },
  subscribeToReadStates: (_familyId: string | null, _userId: string | null, _opts: any) => {
    subState.activeCount += 1;
    subState.readCallbacks = { onNext: (_s: any) => {}, onError: (_e: any) => {} };
    return () => {
      subState.activeCount -= 1;
      subState.readCallbacks = null;
    };
  },
  fetchNotificationsPage: subState.fetchPage,
  markNotificationRead: subState.markRead,
  markAllNotificationsRead: subState.markAll,
}));

import { useNotifications } from './useNotifications';

function makeNotif(id: string): any {
  return {
    id,
    familyId: 'fam',
    type: 'task_approved',
    actorId: 'u1',
    recipientIds: ['u2'],
    title: `T${id}`,
    body: 'b',
    createdAt: { seconds: 1, nanoseconds: 0 },
  };
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subState.activeCount = 0;
    subState.notifCallbacks = null;
    subState.readCallbacks = null;
    subState.notifOptions = null;
    subState.subscribeCalls = [];
    subState.fetchPage.mockResolvedValue([]);
  });

  it('subscribes to the realtime listener (bounded to latest 20 by the lib)', () => {
    renderHook(() => useNotifications('fam', 'u2'));
    expect(subState.subscribeCalls.length).toBe(1);
    expect(subState.notifOptions).toBeTruthy();
  });

  it('marks the connection connected after the first snapshot', async () => {
    const { result } = renderHook(() => useNotifications('fam', 'u2'));
    expect(result.current.connectionState).toBe('connecting');
    act(() => {
      subState.notifCallbacks?.onNext([makeNotif('1')]);
    });
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    expect(result.current.notifications).toHaveLength(1);
  });

  it('marks the connection unavailable on listener error and maps the error', async () => {
    const { result } = renderHook(() => useNotifications('fam', 'u2'));
    act(() => {
      subState.notifCallbacks?.onError({ code: 'unavailable' });
    });
    await waitFor(() => expect(result.current.connectionState).toBe('unavailable'));
    expect(result.current.error).toContain('mapped');
  });

  it('loadMore merges by id so no duplicate rows appear', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => makeNotif(String(i + 1)));
    const { result } = renderHook(() => useNotifications('fam', 'u2'));
    act(() => {
      subState.notifCallbacks?.onNext(initial);
    });
    const page = [
      ...Array.from({ length: 6 }, (_, i) => makeNotif(String(15 + i))), // 15..20 overlap
      ...Array.from({ length: 5 }, (_, i) => makeNotif(String(21 + i))), // 21..25 new
    ];
    subState.fetchPage.mockResolvedValueOnce(page);
    await act(async () => {
      await result.current.loadMore();
    });
    const ids = result.current.notifications.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids.length).toBe(25);
  });

  it('cleans up listeners on sign-out (userId becomes null)', () => {
    const { rerender } = renderHook(({ userId }: { userId: string | null }) => useNotifications('fam', userId), {
      initialProps: { userId: 'u2' as string | null },
    });
    expect(subState.activeCount).toBe(2);
    rerender({ userId: null });
    expect(subState.activeCount).toBe(0);
  });

  it('re-subscribes (and cleans up the old) when familyId changes', () => {
    const { rerender } = renderHook(({ familyId }: { familyId: string | null }) => useNotifications(familyId, 'u2'), {
      initialProps: { familyId: 'fam1' },
    });
    expect(subState.subscribeCalls.length).toBe(1);
    expect(subState.activeCount).toBe(2);
    rerender({ familyId: 'fam2' });
    expect(subState.subscribeCalls.length).toBe(2);
    expect(subState.activeCount).toBe(2); // old unsubscribed, new subscribed
  });

  it('does not create duplicate active subscriptions under Strict Mode', () => {
    renderHook(() => useNotifications('fam', 'u2'), { wrapper: StrictMode });
    // Strict Mode mounts -> unmounts -> remounts; only one set of subs active.
    expect(subState.activeCount).toBe(2);
  });

  it('retry re-subscribes without leaking listeners', () => {
    const { result } = renderHook(() => useNotifications('fam', 'u2'));
    expect(subState.subscribeCalls.length).toBe(1);
    act(() => {
      result.current.retry();
    });
    expect(subState.subscribeCalls.length).toBe(2);
    expect(subState.activeCount).toBe(2);
  });
});
