import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

// Controllable hook state.
const notif = vi.hoisted(() => ({
  state: {
    notifications: [] as any[],
    readIds: new Set<string>(),
    unreadCount: 0,
    error: null as string | null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    markRead: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    retry: vi.fn(),
  },
}));

const store = vi.hoisted(() => ({ current: {} as any }));
const navigate = vi.fn();

vi.mock('../lib/useNotifications', () => ({ useNotifications: () => notif.state }));
vi.mock('../store/useStore', () => ({ useStore: () => store.current }));
vi.mock('../lib/notifications', () => ({
  formatRelativeTime: () => 'just now',
  toMillis: (v: any) => (v && typeof v === 'object' && 'seconds' in v ? v.seconds * 1000 : Date.now()),
  getNotificationTitle: (n: any) =>
    n && typeof n.title === 'string' && n.title.trim().length > 0 ? n.title : 'Notification',
  getNotificationBody: (n: any) =>
    n && typeof n.body === 'string' && n.body.trim().length > 0 ? n.body : 'You have a new update.',
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...(actual as object), useNavigate: () => navigate };
});

import { Notifications } from './Notifications';

function makeNotif(id: string, title: string, overrides: Record<string, any> = {}) {
  return {
    id,
    type: 'task_approved',
    title,
    body: `body-${id}`,
    recipientIds: ['child1'],
    createdAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  } as any;
}

function freshState(overrides: Partial<typeof notif.state> = {}) {
  notif.state = {
    notifications: [],
    readIds: new Set<string>(),
    unreadCount: 0,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    markRead: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    retry: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>,
  );
}

describe('Notifications page', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['common', 'notifications']);
    await i18n.changeLanguage('en');
    freshState();
    store.current = { currentUser: { uid: 'u1', familyId: 'fam1' } };
    navigate.mockClear();
  });

  it('mounts and shows the title', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders All / Unread / Mentions filters', () => {
    renderPage();
    const tablist = screen.getByRole('tablist', { name: 'Notification filters' });
    const tabs = within(tablist).getAllByRole('tab').map(t => t.textContent);
    expect(tabs).toEqual(['All', 'Unread', 'Mentions']);
  });

  it('shows the empty state when there are no notifications', () => {
    freshState({ unreadCount: 0, notifications: [] });
    renderPage();
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });

  it('unread filter hides already-read notifications', () => {
    freshState({
      unreadCount: 1,
      notifications: [makeNotif('1', 'Unread one'), makeNotif('2', 'Read one')],
      readIds: new Set(['2']),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Unread/ }));
    const rows = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.includes('body-'));
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('aria-label')).toContain('body-1');
  });

  it('all filter shows every notification', () => {
    freshState({
      unreadCount: 1,
      notifications: [makeNotif('1', 'Unread one'), makeNotif('2', 'Read one')],
      readIds: new Set(['2']),
    });
    renderPage();
    const rows = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.includes('body-'));
    expect(rows).toHaveLength(2);
  });

  it('clicking a notification marks it read and follows its actionUrl', async () => {
    freshState({
      unreadCount: 1,
      notifications: [makeNotif('1', 'A', { actionUrl: '/tasks' })],
    });
    renderPage();
    const row = screen.getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!;
    fireEvent.click(row);
    await waitFor(() => expect(notif.state.markRead).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks'));
  });

  it('mark-all-read calls the correct API', async () => {
    freshState({
      unreadCount: 3,
      notifications: [makeNotif('1', 'A'), makeNotif('2', 'B'), makeNotif('3', 'C')],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(notif.state.markAllRead).toHaveBeenCalled());
  });

  it('disables mark-all-read when there are no unread', () => {
    freshState({ unreadCount: 0, notifications: [makeNotif('1', 'A')], readIds: new Set(['1']) });
    renderPage();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });
});
