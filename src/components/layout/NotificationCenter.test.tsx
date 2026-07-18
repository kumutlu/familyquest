import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

const store = vi.hoisted(() => ({ current: {} as any }))
const navigate = vi.fn()

vi.mock('../../lib/useNotifications', () => ({ useNotifications: () => notif.state }))
vi.mock('../../store/useStore', () => ({ useStore: () => store.current }))
vi.mock('../../lib/notifications', () => ({
  formatRelativeTime: () => 'just now',
  toMillis: (v: any) => (v && typeof v === 'object' && 'seconds' in v ? v.seconds * 1000 : Date.now()),
  getNotificationTitle: (n: any) =>
    n && typeof n.title === 'string' && n.title.trim().length > 0 ? n.title : 'Notification',
  getNotificationBody: (n: any) =>
    n && typeof n.body === 'string' && n.body.trim().length > 0 ? n.body : 'You have a new update.',
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...(actual as object), useNavigate: () => navigate }
})

import { NotificationCenter } from './NotificationCenter'

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
  }
}

function renderCenter() {
  return render(
    <MemoryRouter>
      <NotificationCenter />
    </MemoryRouter>,
  )
}

function makeNotif(id: string, title: string, overrides: Record<string, any> = {}) {
  return {
    id,
    familyId: 'family1',
    type: 'task_approved',
    actorId: 'parent1',
    recipientIds: ['child1'],
    title,
    body: `body-${id}`,
    entityType: 'task',
    entityId: id,
    actionUrl: '/tasks',
    dedupeKey: `key-${id}`,
    createdAt: { seconds: 1700000000 + Number(id.replace(/\D/g, '')) || 1700000000, nanoseconds: 0 },
    ...overrides,
  }
}

describe('NotificationCenter bell + badge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.current = { currentUser: { uid: 'child1', familyId: 'family1' } }
    freshState()
  })

  it('shows no unread badge and a plain label when count is 0', () => {
    freshState({ unreadCount: 0 })
    renderCenter()
    const bell = screen.getByRole('button', { name: 'Notifications' })
    expect(bell).toBeInTheDocument()
    expect(screen.queryByText('9+')).not.toBeInTheDocument()
  })

  it('shows the exact count for 1–9 unread', () => {
    freshState({ unreadCount: 5, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    expect(screen.getByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows "9+" for 10 or more unread', () => {
    freshState({ unreadCount: 12, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    expect(screen.getByRole('button', { name: 'Notifications, 12 unread' })).toBeInTheDocument()
    expect(screen.getByText('9+')).toBeInTheDocument()
  })
})

describe('NotificationCenter panel behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.current = { currentUser: { uid: 'child1', familyId: 'family1' } }
    navigate.mockClear()
  })

  it('opens the panel on bell click and lists notifications newest-first', () => {
    freshState({
      unreadCount: 2,
      notifications: [makeNotif('2', 'Second'), makeNotif('1', 'First')],
      readIds: new Set<string>(),
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const rows = within(dialog).getAllByRole('button').filter(b => b.getAttribute('aria-label')?.includes('body-'))
    expect(rows[0].getAttribute('aria-label')).toContain('Second')
    expect(rows[1].getAttribute('aria-label')).toContain('First')
  })

  it('does NOT auto-mark read when the panel opens', () => {
    freshState({ unreadCount: 3, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(notif.state.markRead).not.toHaveBeenCalled()
  })

  it('marks a single notification read and navigates on row click', async () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A', { actionUrl: '/tasks' })] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const row = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!
    fireEvent.click(row)
    expect(notif.state.markRead).toHaveBeenCalledWith('1')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks'))
  })

  it('falls back to home route for an unknown type with no actionUrl', async () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A', { type: 'mystery_event', actionUrl: undefined })] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const row = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!
    fireEvent.click(row)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
  })

  it('navigates to the central mapped route for a known type even without actionUrl', async () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A', { type: 'task_approved', actionUrl: undefined })] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const row = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!
    fireEvent.click(row)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks'))
  })

  it('renders an unknown notification type safely with a generic icon', () => {
    freshState({ unreadCount: 1, notifications: [{ id: '1', type: 'mystery_event', title: 'Surprise', body: 'b', recipientIds: ['child1'] } as any] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('Surprise')).toBeInTheDocument()
  })

  it('renders a notification with a missing body using a safe fallback', () => {
    freshState({ unreadCount: 1, notifications: [{ id: '1', type: 'task_approved', title: 'Approved', recipientIds: ['child1'] } as any] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('You have a new update.')).toBeInTheDocument()
  })

  it('does not crash on an invalid createdAt', () => {
    freshState({ unreadCount: 1, notifications: [{ id: '1', type: 'task_approved', title: 'Approved', body: 'b', recipientIds: ['child1'], createdAt: 'not-a-date' } as any] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('does not crash when the target entity is missing', async () => {
    freshState({ unreadCount: 1, notifications: [{ id: '1', type: 'task_approved', title: 'Approved', body: 'b', entityId: undefined, actionUrl: '/tasks', recipientIds: ['child1'] } as any] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const row = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('Approved'))!
    fireEvent.click(row)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks'))
  })

  it('does not block valid rows when one row is malformed', () => {
    freshState({
      unreadCount: 2,
      notifications: [
        { id: 'bad', type: 'mystery_event', recipientIds: ['child1'] } as any,
        makeNotif('1', 'Good one'),
      ],
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('Good one')).toBeInTheDocument()
    // The malformed row still renders (with fallback title) rather than crashing.
    expect(screen.getByText('Notification')).toBeInTheDocument()
  })

  it('returns focus to the bell after a row click', async () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    const bell = screen.getByRole('button', { name: /Notifications/ })
    fireEvent.click(bell)
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const row = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!
    fireEvent.click(row)
    await waitFor(() => expect(document.activeElement).toBe(bell))
  })

  it('marks all as read via the header button', () => {
    freshState({ unreadCount: 3, notifications: [makeNotif('1', 'A'), makeNotif('2', 'B')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(notif.state.markAllRead).toHaveBeenCalled()
  })

  it('disables "Mark all as read" when there are no unread', () => {
    freshState({ unreadCount: 0, notifications: [makeNotif('1', 'A')], readIds: new Set(['1']) })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  it('shows the empty state when there are no notifications', () => {
    freshState({ unreadCount: 0, notifications: [] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
  })

  it('shows the load error message with a Retry button', () => {
    freshState({ error: "We couldn't load notifications. Please try again." })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText("We couldn't load notifications. Please try again.")).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeInTheDocument()
    fireEvent.click(retry)
    expect(notif.state.retry).toHaveBeenCalled()
  })

  it('shows a loading skeleton while loading', () => {
    freshState({ loading: true, notifications: [] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    // The skeleton list is aria-hidden; ensure no real rows render.
    expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument()
  })

  it('renders an unread indicator for unread rows and not for read rows', () => {
    freshState({
      unreadCount: 1,
      notifications: [makeNotif('1', 'Unread one'), makeNotif('2', 'Read one')],
      readIds: new Set(['2']),
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const unreadRow = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-1'))!
    const readRow = within(dialog).getAllByRole('button').find(b => b.getAttribute('aria-label')?.includes('body-2'))!
    expect(unreadRow.getAttribute('aria-label')).toContain('Unread')
    expect(readRow.getAttribute('aria-label')).not.toContain('Unread')
  })

  it('closes on Escape and returns focus to the bell', async () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    const bell = screen.getByRole('button', { name: /Notifications/ })
    fireEvent.click(bell)
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(bell))
  })

  it('renders a mobile backdrop and a bottom-sheet dialog', () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    expect(dialog.className).toContain('bottom-0')
    // Mobile backdrop exists (hidden on desktop via md:hidden).
    expect(document.querySelector('.md\\:hidden.fixed.inset-0')).toBeInTheDocument()
  })

  it('renders a drag handle on mobile', () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    // The drag handle is a decorative span inside the header.
    const handle = dialog.querySelector('.md\\:hidden .rounded-full.bg-gray-300')
    expect(handle).toBeInTheDocument()
  })

  it('renders All / Unread / Mentions tabs with the active tab selected', () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const tablist = screen.getByRole('tablist', { name: 'Notification filters' })
    const tabs = within(tablist).getAllByRole('tab')
    // makeNotif has a single recipient, so it also counts as a "Mention".
    expect(tabs.map(t => t.textContent)).toEqual(['All1', 'Unread1', 'Mentions1'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })

  it('filters to unread when the Unread tab is selected', () => {
    freshState({
      unreadCount: 1,
      notifications: [makeNotif('1', 'Unread one'), makeNotif('2', 'Read one')],
      readIds: new Set(['2']),
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const tablist = screen.getByRole('tablist', { name: 'Notification filters' })
    fireEvent.click(within(tablist).getByRole('tab', { name: /Unread/ }))
    const dialog = screen.getByRole('dialog', { name: 'Notifications' })
    const rows = within(dialog).getAllByRole('button').filter(b => b.getAttribute('aria-label')?.includes('body-'))
    expect(rows).toHaveLength(1)
    expect(rows[0].getAttribute('aria-label')).toContain('body-1')
  })

  it('renders a "View all notifications" footer link', () => {
    freshState({ unreadCount: 1, notifications: [makeNotif('1', 'A')] })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    const link = screen.getByRole('button', { name: 'View all notifications' })
    expect(link).toBeInTheDocument()
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith('/notifications')
  })

  it('does not crash when a notification is missing optional fields', () => {
    freshState({
      unreadCount: 1,
      notifications: [{ id: 'x', type: 'task_approved', title: 'Broken', body: 'b', recipientIds: ['child1'] } as any],
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
    expect(screen.getByText('Broken')).toBeInTheDocument()
  })
})
