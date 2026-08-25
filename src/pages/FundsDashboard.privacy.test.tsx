import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext'

const state = vi.hoisted(() => ({
  current: {
    currentUser: { id: 'child-private', familyId: 'family-1', role: 'child', displayName: 'Ada' },
    familyData: { id: 'family-1', currency: '£', petBoxEnabled: true },
    myWallet: { balance: 87_643 },
    funds: [{
      id: 'fund-1',
      name: 'Milo',
      type: 'pet',
      species: 'cat',
      balance: 43_210,
      monthlyBudget: 11_111,
      emergencyGoal: 76_543,
    }],
    fundTransactions: [],
    petboxRequests: [],
    reversals: [],
    familyMembers: [],
  } as any,
}))

vi.mock('../store/useStore', () => {
  const useStore = (selector?: any) => (
    typeof selector === 'function' ? selector(state.current) : state.current
  )
  useStore.getState = () => state.current
  return { useStore }
})

import { FundsDashboard } from './FundsDashboard'

describe('FundsDashboard money privacy', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('queki.moneyPrivacy:child-private', 'true')
  })

  it('masks only the source wallet and keeps Cat Box fund and goal values visible', async () => {
    const { container } = render(
      <MoneyPrivacyProvider>
        <FundsDashboard />
      </MoneyPrivacyProvider>,
    )

    await waitFor(() => expect(container).not.toHaveTextContent('876.43'))
    expect(screen.getByText('£••••')).toBeInTheDocument()
    expect(screen.getByTestId('fund-balance')).toHaveTextContent('£432.10')
    expect(screen.getByText('£432.10 / £765.43')).toBeInTheDocument()
  })
})
