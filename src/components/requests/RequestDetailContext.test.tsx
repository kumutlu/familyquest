import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import i18n from '../../i18n/config'
import { RequestDetailProvider, useRequestDetail } from './RequestDetailContext'

const request = {
  id: 'mr-1',
  category: 'money_request',
  requesterId: 'child-1',
  requesterName: 'Mnalium',
  requestedFromId: 'parent-1',
  requestedFromName: 'Kemal',
  requestedFromRole: 'parent',
  amountPence: 556,
  status: 'pending_acceptance',
  createdAt: { toDate: () => new Date() },
}

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => {
    const state = {
      currentUser: { id: 'u1', familyId: 'f1', role: 'owner', displayName: 'Kemal' },
      familyMembers: [], familyData: { currency: '£' }, tasks: [], rewards: [],
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

function Harness() {
  const { openRequest, closeRequest } = useRequestDetail()
  return (
    <div>
      <button data-testid="trigger" onClick={() => openRequest(request)}>Open</button>
      <button data-testid="closer" onClick={() => closeRequest()}>Close</button>
    </div>
  )
}

describe('RequestDetailContext focus return', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['requests']);
    await i18n.changeLanguage('en');
  });

  it('returns focus to the triggering element after the sheet closes', async () => {
    render(
      <RequestDetailProvider>
        <Harness />
      </RequestDetailProvider>,
    )

    const trigger = screen.getByTestId('trigger')
    trigger.focus() // simulate the user tabbing to the trigger before activating it
    fireEvent.click(trigger) // opens the sheet
    expect(screen.getByRole('heading', { name: 'Money Request' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('closer'))
    expect(screen.queryByRole('heading', { name: 'Money Request' })).not.toBeInTheDocument()

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
