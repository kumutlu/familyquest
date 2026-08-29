import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileEditorModal } from './ProfileEditorModal'

const updateDocMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return { ...actual, updateDoc: updateDocMock }
})

const submitMock = vi.hoisted(() => vi.fn(async () => {}))
const updateOwnCosmeticProfileMock = vi.hoisted(() => vi.fn(async () => {}))
const unlockMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    submitProfileUpdateRequest: submitMock,
    updateOwnCosmeticProfile: updateOwnCosmeticProfileMock,
    unlockAvatar: unlockMock,
  }
})

const mapTransactionErrorMock = vi.hoisted(() =>
  vi.fn((err: any) => {
    if (err && err.code) return "We couldn't submit your profile changes. Please try again."
    return err?.message || "We couldn't submit your profile changes. Please try again."
  }),
)
vi.mock('../../lib/transactionErrors', () => ({
  mapTransactionError: (err: any) => mapTransactionErrorMock(err),
}))

const storeState = vi.hoisted(() => ({ profileUpdateRequests: [] as any[], avatarUnlocks: [] as any[] }))
vi.mock('../../store/useStore', () => ({
  useStore: (selector: (s: any) => any) => selector(storeState),
}))

function renderModal(user: any) {
  return render(<ProfileEditorModal user={user} onClose={() => {}} />)
}

afterEach(() => {
  globalThis.innerWidth = 1024
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
  document.body.style.touchAction = ''
})

describe('ProfileEditorModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    storeState.profileUpdateRequests = []
    storeState.avatarUnlocks = []
    updateDocMock.mockResolvedValue(undefined)
    updateOwnCosmeticProfileMock.mockResolvedValue(undefined)
    globalThis.innerWidth = 1024
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
    document.body.style.touchAction = ''
  })

  it('owner/parent saves immediately via updateDoc (no approval)', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'p1', role: 'owner', displayName: 'Kemal', avatarUrl: '', avatarId: 'starter-robot', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Kemal Updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateDocMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ displayName: 'Kemal Updated', avatarId: 'starter-robot' }),
      ),
    )
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('child saves their own profile immediately without creating an approval request', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateOwnCosmeticProfileMock).toHaveBeenCalledWith('c1', 'Muhammed', 'starter-cat', expect.anything()))
    expect(submitMock).not.toHaveBeenCalled()
    expect(updateDocMock).not.toHaveBeenCalled()
    expect(screen.getAllByText('Profile updated').length).toBeGreaterThan(0)
    expect(screen.queryByText(/parent approval/i)).toBeNull()
  })

  it('child creator change is saved immediately as avatarConfig', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', familyId: 'f1' })
    await user.click(screen.getByRole('tab', { name: 'Hair' }))
    await user.click(screen.getByRole('button', { name: 'Curls' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateOwnCosmeticProfileMock).toHaveBeenCalledWith(
      'c1',
      'Muhammed Osman',
      'starter-cat',
      expect.objectContaining({ avatarConfig: expect.objectContaining({ version: 1, hairStyle: 'curls' }) }),
    ))
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('Cancel after editing the creator does not persist anything', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ProfileEditorModal user={{ id: 'c1', role: 'child', displayName: 'Ada', familyId: 'f1' }} onClose={onClose} />)
    await user.click(screen.getByRole('tab', { name: 'Hair' }))
    await user.click(screen.getByRole('button', { name: 'Curls' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(submitMock).not.toHaveBeenCalled()
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('shows the required failure copy without referring to parent approval', async () => {
    const user = userEvent.setup()
    updateOwnCosmeticProfileMock.mockRejectedValueOnce(new Error('permission denied'))
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Hacked')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getAllByText('Your profile could not be updated. Please try again.').length).toBeGreaterThan(0))
    expect(screen.queryByText(/parent/i)).toBeNull()
  })

  it('shows a friendly error for an empty name and does not submit', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, '   ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.getAllByText(/cannot be empty/i).length).toBeGreaterThan(0),
    )
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('does not lock direct profile editing because of a historical pending request', async () => {
    storeState.profileUpdateRequests = [{ childId: 'c1', status: 'pending' }]
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    expect(screen.getByLabelText('Display Name')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.queryByText(/awaiting parent approval/i)).toBeNull()
  })

  it('removes the raw Avatar URL input (uses curated picker)', async () => {
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    expect(screen.queryByLabelText(/Avatar URL/i)).toBeNull()
    expect(screen.getByText(/Choose Avatar/i)).toBeInTheDocument()
  })

  it('mobile: Save button is visible and clickable (sticky footer above nav)', async () => {
    // Simulate a mobile viewport so the bottom-nav / safe-area layout applies.
    globalThis.innerWidth = 390
    window.dispatchEvent(new Event('resize'))
    const user = userEvent.setup()
    renderModal({ id: 'p1', role: 'owner', displayName: 'Kemal', avatarUrl: '', avatarId: 'starter-robot', familyId: 'f1' })

    const saveButton = screen.getByRole('button', { name: 'Save' })
    // Visible in the mobile layout (not display:none / zero-size).
    expect(saveButton).toBeVisible()
    // Clickable: triggers the save path (updateDoc) without error.
    await user.click(saveButton)
    await waitFor(() =>
      expect(updateDocMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ displayName: 'Kemal', avatarId: 'starter-robot' }),
      ),
    )
  })

  it('child with no avatar: display-name-only save sends null avatarId', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: null, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateOwnCosmeticProfileMock).toHaveBeenCalled())
    const callArgs = updateOwnCosmeticProfileMock.mock.calls[0] as any[]
    expect(callArgs[1]).toBe('Muhammed')
    expect(callArgs[2]).toBeNull()
  })

  it('preserves entered changes after a failed save (no data loss)', async () => {
    const user = userEvent.setup()
    updateOwnCosmeticProfileMock.mockRejectedValueOnce(new Error('Network error'))
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed Jr')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getAllByText('Your profile could not be updated. Please try again.').length).toBeGreaterThan(0))
    expect((screen.getByLabelText('Display Name') as HTMLInputElement).value).toBe('Muhammed Jr')
  })

  it('maps a permission-denied error to the required child-safe message', async () => {
    const user = userEvent.setup()
    updateOwnCosmeticProfileMock.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed Jr')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getAllByText('Your profile could not be updated. Please try again.').length).toBeGreaterThan(0))
    expect(screen.queryByText(/parent/i)).toBeNull()
    expect(screen.queryByText(/permission/i)).toBeNull()
  })
})
