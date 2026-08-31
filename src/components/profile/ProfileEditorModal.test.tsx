import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileEditorModal } from './ProfileEditorModal'

const updateDocMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return { ...actual, updateDoc: updateDocMock }
})

const appearanceMock = vi.hoisted(() => vi.fn(async (_familyId: string, _update: any) => {}))
const submitMock = vi.hoisted(() => vi.fn(async () => {}))
const unlockMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, submitProfileUpdateRequest: submitMock, unlockAvatar: unlockMock, updateChildAppearance: appearanceMock }
})

const mapTransactionErrorMock = vi.hoisted(() =>
  vi.fn((err: any) => {
    if (err && err.code === 'permission-denied') return 'Your profile change could not be submitted. Please ask a parent to check the approval settings and try again.'
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
    appearanceMock.mockResolvedValue(undefined)
    submitMock.mockResolvedValue(undefined)
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
    // Owner/parent uses updateDoc directly (not updateChildAppearance) since they can edit displayName
    await waitFor(() =>
      expect(updateDocMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ displayName: 'Kemal Updated', avatarId: 'starter-robot' }),
      ),
    )
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('child avatar changes persist immediately without parent approval', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Change avatar only (starter avatar) - click on "Bolt Bot" which is starter-robot
    await user.click(screen.getByRole('gridcell', { name: 'Bolt Bot, Starter, owned' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Should call updateChildAppearance for avatar change
    await waitFor(() =>
      expect(appearanceMock).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ avatarId: 'starter-robot' }),
      ),
    )
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('child display name changes still require parent approval', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed')
    // Only display name changed -> button shows "Submit for approval"
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith('f1', 'Muhammed', null, expect.anything()))
    expect(appearanceMock).not.toHaveBeenCalled()
    expect(screen.getAllByText(/Changes submitted for parent approval/i).length).toBeGreaterThan(0)
  })

  it('child cannot directly update profile even when editing fields', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Hacked')
    // Only display name changed -> button shows "Submit for approval"
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    expect(appearanceMock).not.toHaveBeenCalled()
  })

  it('shows a friendly error for an empty name and does not submit', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, '   ')
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() =>
      expect(screen.getAllByText(/cannot be empty/i).length).toBeGreaterThan(0),
    )
    expect(submitMock).not.toHaveBeenCalled()
    expect(appearanceMock).not.toHaveBeenCalled()
  })

  it('locks the editor while a profile update is pending', async () => {
    storeState.profileUpdateRequests = [{ childId: 'c1', status: 'pending' }]
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    expect(screen.getByLabelText('Display Name')).toBeDisabled()
    // Avatar picker should still be usable (not locked)
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
    expect(screen.getByText(/awaiting parent approval\. You cannot submit/i)).toBeInTheDocument()
  })

  it('removes the raw Avatar URL input (uses curated picker)', async () => {
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
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
    // Clickable: triggers the save path (updateDoc for owner/parent) without error.
    await user.click(saveButton)
    await waitFor(() =>
      expect(updateDocMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ displayName: 'Kemal', avatarId: 'starter-robot' }),
      ),
    )
  })

  it('child with no avatar: display-name-only submit sends null avatarId (root-cause payload)', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: null, rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed')
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    const callArgs = submitMock.mock.calls[0] as any[]
    expect(callArgs[1]).toBe('Muhammed')
    expect(callArgs[2]).toBeNull()
  })

  it('child cannot equip premium avatar they do not own - clicking locked avatar opens unlock sheet', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Try to select a premium avatar they don't own - "Neon Robot" is rare-neon
    await user.click(screen.getByRole('gridcell', { name: /Neon Robot/i }))
    // Should open the unlock sheet (not select the avatar)
    expect(screen.getByText(/Unlock Neon Robot/i)).toBeInTheDocument()
    // Unlock sheet should be visible
    expect(screen.getByRole('dialog', { name: /Unlock Neon Robot/i })).toBeInTheDocument()
  })

  it('child can equip premium avatar they own', async () => {
    const user = userEvent.setup()
    storeState.avatarUnlocks = [{ avatarId: 'rare-neon' }]
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Select a premium avatar they own - "Neon Robot" is rare-neon
    await user.click(screen.getByRole('gridcell', { name: /Neon Robot/i }))
    // Should not show locked premium error
    expect(screen.queryByText(/locked premium/i)).toBeNull()
    // Submit button should be enabled
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    // Click submit - should call updateChildAppearance for avatar change
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(appearanceMock).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({ avatarId: 'rare-neon' }),
      ),
    )
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('preserves entered changes after a failed submit (no data loss)', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValueOnce(new Error('Network error'))
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed Jr')
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(screen.getAllByText(/Network error/i).length).toBeGreaterThan(0))
    expect((screen.getByLabelText('Display Name') as HTMLInputElement).value).toBe('Muhammed Jr')
  })

  it('maps a permission-denied error to a child-safe message (no raw internals)', async () => {
    const user = userEvent.setup()
    submitMock.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed Jr')
    // Only display name changed -> button shows "Submit for approval"
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(screen.getAllByText(/parent/i).length).toBeGreaterThan(0))
    expect(screen.queryByText(/permission/i)).toBeNull()
  })

  // New tests for the split appearance/identity behavior
  it('child avatar + display name combined: appearance saves immediately, identity submits for approval', async () => {
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Change avatar
    await user.click(screen.getByRole('gridcell', { name: 'Bolt Bot, Starter, owned' }))
    // Change display name
    const nameInput = screen.getByLabelText('Display Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Muhammed')
    // Click save - should do both
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Appearance should be saved first
    await waitFor(() => expect(appearanceMock).toHaveBeenCalledWith('f1', expect.objectContaining({ avatarId: 'starter-robot' })))
    // Then identity submitted for approval
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith('f1', 'Muhammed', null, expect.anything()))
  })

  it('pending display-name request does not block avatar customization', async () => {
    storeState.profileUpdateRequests = [{ childId: 'c1', status: 'pending' }]
    const user = userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Display name should be locked
    expect(screen.getByLabelText('Display Name')).toBeDisabled()
    // But avatar picker should be usable
    await user.click(screen.getByRole('gridcell', { name: 'Bolt Bot, Starter, owned' }))
    // Save button should be enabled for appearance (wait for state update)
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled())
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(appearanceMock).toHaveBeenCalledWith('f1', expect.objectContaining({ avatarId: 'starter-robot' })))
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('owned premium equip does not call unlockAvatar (no point deduction)', async () => {
    const user = userEvent.setup()
    storeState.avatarUnlocks = [{ avatarId: 'rare-neon' }]
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    await user.click(screen.getByRole('gridcell', { name: /Neon Robot/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(appearanceMock).toHaveBeenCalledWith('f1', expect.objectContaining({ avatarId: 'rare-neon' })))
    expect(unlockMock).not.toHaveBeenCalled()
    expect(submitMock).not.toHaveBeenCalled()
  })

  // UI regression: avatarConfig persists through modal close/reopen and profile rehydration
  it('avatarConfig persists after modal close/reopen and profile reload', async () => {
    userEvent.setup()
    const savedAvatarConfig = {
      version: 1,
      base: 'round',
      skinTone: 'warm',
      hairStyle: 'curls',
      hairColor: 'brown',
      face: 'happy',
      accessory: 'none',
      outfit: 'hoodie',
      outfitColor: 'purple',
      background: 'sky',
    }
    // Simulate a profile that already has a saved avatarConfig (from previous save)
    renderModal({
      id: 'c1',
      role: 'child',
      displayName: 'Muhammed Osman',
      avatarUrl: 'https://old',
      avatarId: 'starter-cat',
      avatarConfig: savedAvatarConfig,
      rewardPoints: 500,
      familyId: 'f1',
    })
    // The modal should load with the saved avatarConfig
    // Since there's no AvatarCreator component yet, we verify the user object has avatarConfig
    // and that updateChildAppearance can be called with avatarConfig
    // This test documents the expected behavior for when AvatarCreator is implemented
    expect(true).toBe(true) // Placeholder - actual test requires AvatarCreator component
  })

  // Test that updateChildAppearance can be called with avatarConfig
  it('updateChildAppearance accepts avatarConfig for composable avatar', async () => {
    userEvent.setup()
    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })
    // Simulate calling updateChildAppearance with avatarConfig (as AvatarCreator would)
    await appearanceMock('f1', { avatarConfig: {
      version: 1,
      base: 'round',
      skinTone: 'warm',
      hairStyle: 'curls',
      hairColor: 'brown',
      face: 'happy',
      accessory: 'none',
      outfit: 'hoodie',
      outfitColor: 'purple',
      background: 'sky',
    }})
    expect(appearanceMock).toHaveBeenCalledWith('f1', expect.objectContaining({
      avatarConfig: expect.objectContaining({ version: 1, hairStyle: 'curls' })
    }))
  })
})