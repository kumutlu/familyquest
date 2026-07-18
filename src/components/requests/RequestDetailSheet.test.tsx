import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RequestDetailSheet } from './RequestDetailSheet'

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => {
    const state = {
      currentUser: { id: 'u1', familyId: 'f1', role: 'owner', displayName: 'Kemal' },
      familyMembers: [], familyData: { currency: '£' }, tasks: [], rewards: [],
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

// Force normalizeRequest to throw so we exercise the error/fallback path.
vi.mock('../../lib/requestModel', async () => {
  const actual = await vi.importActual<typeof import('../../lib/requestModel')>('../../lib/requestModel')
  return {
    ...actual,
    normalizeRequest: () => {
      throw new Error('cannot normalise')
    },
  }
})

describe('RequestDetailSheet error safety', () => {
  it('shows a friendly error instead of crashing when a request cannot be loaded', () => {
    render(<RequestDetailSheet request={{ id: 'x', category: 'money_request' }} onClose={() => {}} />)
    expect(screen.getByText(/We couldn.t load this request/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('Close dismisses the error sheet without exposing internals', () => {
    const onClose = vi.fn()
    render(<RequestDetailSheet request={{ id: 'x', category: 'money_request' }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/cannot normalise/i)).not.toBeInTheDocument()
  })
})
