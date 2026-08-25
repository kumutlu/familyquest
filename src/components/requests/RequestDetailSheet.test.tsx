import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestDetailSheet } from './RequestDetailSheet'
import { RequestMoneyModal } from '../wallet/RequestMoneyModal'
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext'
import i18n from '../../i18n/config'

const storeState = vi.hoisted(() => ({
  current: {
    currentUser: { id: 'u1', familyId: 'f1', role: 'owner', displayName: 'Kemal' },
    familyMembers: [{ id: 'parent-2', familyId: 'f1', role: 'parent', displayName: 'Aylin' }],
    familyData: { currency: '£' },
    tasks: [],
    rewards: [],
  } as any,
}))

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => {
    const state = storeState.current
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
  beforeEach(async () => {
    localStorage.clear()
    await i18n.loadNamespaces(['requests', 'approvals', 'common']);
    await i18n.changeLanguage('en');
  });
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

describe('active money request entry privacy', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('queki.moneyPrivacy:u1', 'true')
    await i18n.loadNamespaces(['wallet', 'common'])
    await i18n.changeLanguage('en')
  })

  it('keeps the editable request amount visible while privacy is enabled', () => {
    render(
      <MoneyPrivacyProvider>
        <RequestMoneyModal onClose={() => {}} />
      </MoneyPrivacyProvider>,
    )

    const amountInput = screen.getByRole('spinbutton')
    fireEvent.change(amountInput, { target: { value: '12.34' } })

    expect(amountInput).toHaveValue(12.34)
    expect(amountInput).toHaveDisplayValue('12.34')
  })
})
