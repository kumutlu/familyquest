import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n/config'

// Regression test for the notification read/update failure.
//
// Root cause: the notification surfaces derived the read-state `userId` from
// `currentUser?.uid`. For a managed child the store's `currentUser.uid` is the
// synthetic Auth UID, which is NOT the same as the profile document id that
// `authProfileId()` resolves to in the Firestore `notification_reads` rule
// (`authProfileId() == request.resource.data.userId`). The write was therefore
// rejected with permission-denied and surfaced as
// "We couldn't update this notification." The canonical identity the rest of
// the app uses is `currentUser?.id` (the profile document id), which always
// equals `authProfileId()`.
//
// This test drives the REAL `useNotifications` hook (so the `userId` the
// component computes actually flows through to `markNotificationRead`) while
// spying on the repository write. A managed child with a divergent `uid` and
// `id` clicks a notification; we assert the write uses the profile id.

const markReadSpy = vi.fn(async () => {})
const markAllSpy = vi.fn(async () => {})

// Captured by the mocked subscription so the test can push notifications
// inside `act` (mirrors useNotifications.test.ts).
const notifCallbacks = vi.hoisted(() => ({ onNext: null as null | ((l: any[]) => void) }))

vi.mock('../../lib/notifications', () => ({
  markNotificationRead: (...args: any[]) => markReadSpy(...args),
  markAllNotificationsRead: (...args: any[]) => markAllSpy(...args),
  fetchNotificationsPage: vi.fn(async () => [{ id: 'n1' }]),
  subscribeToNotifications: (_familyId: string | null, _userId: string | null, opts: any) => {
    notifCallbacks.onNext = opts.onNext
    return () => {
      notifCallbacks.onNext = null
    }
  },
  subscribeToReadStates: () => () => {},
  formatRelativeTime: () => 'just now',
  toMillis: (v: any) => (v && typeof v === 'object' && 'seconds' in v ? v.seconds * 1000 : Date.now()),
  getNotificationTitle: (n: any) =>
    n && typeof n.title === 'string' && n.title.trim().length > 0 ? n.title : 'Notification',
  getNotificationBody: (n: any) =>
    n && typeof n.body === 'string' && n.body.trim().length > 0 ? n.body : 'You have a new update.',
  NOTIFICATION_PAGE_SIZE: 20,
  NOTIFICATION_LOAD_ERROR: "We couldn't load notifications. Please try again.",
  mapNotificationError: (e: any) => {
    switch (e?.code) {
      case 'permission-denied':
        return "We couldn't update this notification."
      case 'unavailable':
      case 'deadline-exceeded':
        return "We couldn't load notifications. Please try again."
      default:
        return "We couldn't load notifications. Please try again."
    }
  },
}))

const store = vi.hoisted(() => ({ current: {} as any }))
const navigate = vi.fn()
vi.mock('../../store/useStore', () => ({ useStore: (selector: any) => selector(store.current) }))
vi.mock('../../lib/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...(actual as object), useNavigate: () => navigate }
})

import { NotificationCenter } from './NotificationCenter'

// A managed child: profile id `mc1` (what authProfileId() resolves to) differs
// from the synthetic Auth UID `mc-auth-1` carried in `currentUser.uid`.
const managedChild = {
  id: 'mc1',
  uid: 'mc-auth-1',
  familyId: 'fam1',
  role: 'child',
  displayName: 'Managed',
}

const SAMPLE_NOTIFICATION = {
  id: 'n1',
  familyId: 'fam1',
  type: 'task_approved',
  actorId: 'parent1',
  recipientIds: ['mc1'],
  title: 'Task approved',
  body: 'Nice work',
  entityType: 'task',
  entityId: 'task1',
  actionUrl: '/tasks',
  dedupeKey: 'task_approve_task1',
  createdAt: { seconds: 1700000000, nanoseconds: 0 },
}

beforeEach(async () => {
  vi.clearAllMocks()
  markReadSpy.mockClear()
  markAllSpy.mockClear()
  navigate.mockClear()
  notifCallbacks.onNext = null
  await i18n.loadNamespaces(['notifications', 'common'])
  await i18n.changeLanguage('en')
  store.current = { currentUser: managedChild, familyData: { petBoxEnabled: true } }
})

function renderCenter() {
  return render(
    <MemoryRouter>
      <NotificationCenter />
    </MemoryRouter>,
  )
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }))
}

function pushNotifications() {
  act(() => {
    notifCallbacks.onNext?.([SAMPLE_NOTIFICATION])
  })
}

describe('notification read/update identity (managed child)', () => {
  it('marks a notification read using the profile id, not the synthetic auth uid', async () => {
    renderCenter()
    pushNotifications()
    openPanel()

    const row = await screen.findByRole('button', { name: /Task approved/ })
    fireEvent.click(row)

    await waitFor(() => expect(markReadSpy).toHaveBeenCalled())
    // The write must target the profile id (mc1) that authProfileId() resolves
    // to, NOT the synthetic auth uid (mc-auth-1) that currentUser.uid holds.
    expect(markReadSpy).toHaveBeenCalledWith('fam1', 'mc1', 'n1')
    expect(markReadSpy).not.toHaveBeenCalledWith('fam1', 'mc-auth-1', 'n1')
  })

  it('does not surface an error banner when the read update succeeds', async () => {
    renderCenter()
    pushNotifications()
    openPanel()

    const row = await screen.findByRole('button', { name: /Task approved/ })
    fireEvent.click(row)

    await waitFor(() => expect(markReadSpy).toHaveBeenCalled())
    // No error banner on a successful update.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still surfaces the error banner when the read update is genuinely rejected', async () => {
    // A genuine rejection (e.g. a real permission-denied from Firestore) must
    // still surface to the user. We exercise the "Mark all as read" path
    // because it keeps the panel open (the row-click path closes it), so the
    // banner remains inspectable.
    markAllSpy.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    renderCenter()
    pushNotifications()
    openPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    // The genuine rejection must still surface to the user.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(within(screen.getByRole('alert')).getByText(/couldn't update this notification/i)).toBeInTheDocument()
  })
})
