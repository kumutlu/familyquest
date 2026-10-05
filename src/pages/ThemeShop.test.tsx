/**
 * ThemeShop UI tests.
 *
 * Pins the child-facing UX contract (spec §4/§5/§21):
 *   - Free / Owned / Locked / Current states are visually distinct labels
 *   - price renders from the authoritative shop model
 *   - preview opens from a card and never persists ownership
 *   - buying requires an explicit confirmation step
 *   - locked themes cannot be applied without purchase
 *   - the purchase button disables during an in-flight transaction
 *   - a second click during flight cannot start a duplicate purchase
 *
 * The store and purchase pipeline are mocked; i18n falls back to the
 * inline defaultValue strings so assertions are language-stable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useSyncExternalStore } from 'react'

type StoreState = Record<string, unknown>

let storeState: StoreState = {}
const storeListeners = new Set<() => void>()

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: StoreState) => unknown) => useSyncExternalStore(
    (onStoreChange) => {
      storeListeners.add(onStoreChange)
      return () => { storeListeners.delete(onStoreChange) }
    },
    () => selector(storeState),
    () => selector(storeState),
  ),
}))

function setStore(next: StoreState) {
  storeState = { ...storeState, ...next }
  for (const listener of storeListeners) listener()
}

const purchaseMock = vi.hoisted(() => vi.fn(async () => ({ costPoints: 500, themeId: 'theme.shop.space' })))
const updateThemeMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    purchaseShopTheme: purchaseMock,
    updateChildTheme: updateThemeMock,
  }
})

import { ThemeShop } from './ThemeShop'
import { setThemeShopClock } from '../hooks/useThemeShop'
import { resetExperienceState } from '../hooks/useExperienceTheme'
import i18n from '../i18n/config'

beforeEach(async () => {
  // The themes namespace suspends until loaded; seed it before render.
  await i18n.loadNamespaces(['themes'])
  await i18n.changeLanguage('en')
})

function renderShop() {
  return render(
    <MemoryRouter initialEntries={['/themes']}>
      <ThemeShop />
    </MemoryRouter>,
  )
}

const BASE_STORE: StoreState = {
  // `rewardPoints` is the child's spendable balance and drives the shop's
  // affordability model, so the fixture carries a realistic wallet.
  currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 1000 },
  familyData: { id: 'family-1' },
  themeShopItems: [],
  themePurchases: [],
}

describe('ThemeShop — shop list', () => {
  beforeEach(() => {
    storeListeners.clear()
    purchaseMock.mockClear()
    purchaseMock.mockImplementation(async () => ({ costPoints: 500, themeId: 'theme.shop.space' }))
    updateThemeMock.mockClear()
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    resetExperienceState()
    setStore(BASE_STORE)
    localStorage.clear()
  })

  it('renders the classic card with a Free badge and every shop theme card', () => {
    renderShop()
    expect(screen.getByTestId('theme-card-classic')).toBeInTheDocument()
    for (const id of ['neon', 'space', 'rainbow', 'pixel', 'calm']) {
      expect(screen.getByTestId(`theme-card-${id}`)).toBeInTheDocument()
    }
    // Preview surfaces render with the real theme ids.
    expect(screen.getByTestId('theme-preview-theme.standard')).toBeInTheDocument()
    expect(screen.getByTestId('theme-preview-theme.shop.space')).toBeInTheDocument()
  })

  it('shows the Free label on unlocked items and the point price on locked ones', () => {
    renderShop()
    // Locked space card carries the authoritative price (built-in 500).
    const space = within(screen.getByTestId('theme-card-space'))
    expect(space.getByText('500 pts')).toBeInTheDocument()
    // Calm card likewise 300.
    expect(within(screen.getByTestId('theme-card-calm')).getByText('300 pts')).toBeInTheDocument()
  })

  it('marks owned items with an Owned label and no price', () => {
    setStore({ themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }] })
    renderShop()
    const space = within(screen.getByTestId('theme-card-space'))
    // The preview badge AND the footer state row both mark ownership; the
    // footer row (data-testid theme-state-space) is the canonical one.
    expect(space.getAllByText('Owned').length).toBeGreaterThan(0)
    expect(space.queryByText('500 pts')).not.toBeInTheDocument()
  })

  it('marks the active theme as Current on its card', () => {
    setStore({ currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' } })
    setStore({ themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }] })
    renderShop()
    const space = within(screen.getByTestId('theme-card-space'))
    expect(space.getByText('Current')).toBeInTheDocument()
  })

  it('marks a Theme of the Week as Free this week with no price', () => {
    const NOW = Date.UTC(2026, 8, 28, 12, 0, 0)
    setThemeShopClock(() => NOW)
    setStore({
      themeShopItems: [{
        id: 'space', shopItemId: 'space', themeId: 'theme.shop.space', pricePoints: 500, isActive: true,
        promo: { themeId: 'theme.shop.space', startsAt: NOW - 1000, endsAt: NOW + 60_000 },
      }],
    })
    renderShop()
    const space = within(screen.getByTestId('theme-card-space'))
    expect(space.getByText('Free this week')).toBeInTheDocument()
    expect(space.queryByText('500 pts')).not.toBeInTheDocument()
    // Banner names the promoted theme.
    expect(screen.getByTestId('theme-of-the-week-banner')).toHaveTextContent('Space Explorer')
  })
})

describe('ThemeShop — focus / preview lifecycle', () => {
  beforeEach(() => {
    storeListeners.clear()
    purchaseMock.mockClear()
    updateThemeMock.mockClear()
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    resetExperienceState()
    setStore(BASE_STORE)
    localStorage.clear()
  })

  it('opening a preview shows Previewing state with Buy and Back, without applying the theme', async () => {
    const user = userEvent.setup()
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    // Preview is live (focused card renders its preview)…
    expect(within(focus).getByTestId('theme-preview-theme.shop.space')).toBeInTheDocument()
    // …the buy CTA is present…
    expect(within(focus).getByRole('button', { name: 'Buy for 500 points' })).toBeInTheDocument()
    // …and nothing was applied or purchased.
    expect(updateThemeMock).not.toHaveBeenCalled()
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('cancelling the preview returns to the list without persisting anything', async () => {
    const user = userEvent.setup()
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    await user.click(within(screen.getByTestId('theme-shop-focus')).getByRole('button', { name: 'Back' }))
    expect(screen.queryByTestId('theme-shop-focus')).not.toBeInTheDocument()
    expect(screen.getByTestId('theme-shop')).toBeInTheDocument()
    expect(updateThemeMock).not.toHaveBeenCalled()
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('a locked theme cannot be applied without purchase — only Buy is offered', async () => {
    const user = userEvent.setup()
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).queryByRole('button', { name: 'Use this theme' })).not.toBeInTheDocument()
    expect(within(focus).getByRole('button', { name: 'Buy for 500 points' })).toBeInTheDocument()
  })

  it('buying requires an explicit confirmation step; declining buys nothing', async () => {
    const user = userEvent.setup()
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    const confirm = within(focus).getByTestId('purchase-confirmation')
    // The sheet sells the world: the theme, its price, and the balance maths.
    expect(confirm).toHaveTextContent('Space Explorer')
    expect(confirm).toHaveTextContent('500 points')
    expect(within(confirm).getByTestId('sheet-balance')).toHaveTextContent('1000 points')
    expect(within(confirm).getByTestId('sheet-after')).toHaveTextContent('500 points')
    // …and it previews the real, painted world rather than a wireframe.
    expect(within(confirm).getByTestId('theme-preview-theme.shop.space')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Not now' }))
    expect(purchaseMock).not.toHaveBeenCalled()
    expect(within(focus).queryByTestId('purchase-confirmation')).not.toBeInTheDocument()
  })

  it('confirming buys through the canonical pipeline and applies the theme', async () => {
    const user = userEvent.setup()
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    await user.click(within(focus).getByRole('button', { name: 'Unlock for 500 points' }))
    await vi.waitFor(() => expect(purchaseMock).toHaveBeenCalledWith('family-1', 'space'))
    await vi.waitFor(() => expect(updateThemeMock).toHaveBeenCalledWith('theme.shop.space'))
  })

  it('an owned theme offers Apply, which writes only the theme preference', async () => {
    const user = userEvent.setup()
    setStore({ themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }] })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).getByRole('button', { name: 'Use this theme' })).toBeInTheDocument()
    expect(within(focus).queryByRole('button', { name: /Buy for/ })).not.toBeInTheDocument()
    await user.click(within(focus).getByRole('button', { name: 'Use this theme' }))
    await vi.waitFor(() => expect(updateThemeMock).toHaveBeenCalledWith('theme.shop.space'))
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('the classic theme applies without purchase', async () => {
    const user = userEvent.setup()
    setStore({ currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' } })
    setStore({ themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }] })
    renderShop()
    await user.click(screen.getByTestId('theme-card-classic'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Use this theme' }))
    await vi.waitFor(() => expect(updateThemeMock).toHaveBeenCalledWith('theme.standard'))
  })

  it('disables the confirm buttons while the purchase is in flight and refuses a second attempt', async () => {
    const user = userEvent.setup()
    let release!: (value: { costPoints: number; themeId: string }) => void
    purchaseMock.mockImplementationOnce(() => new Promise<{ costPoints: number; themeId: string }>(resolve => { release = resolve }))
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    const confirmButton = within(within(focus).getByTestId('purchase-confirmation')).getByRole('button', { name: 'Unlock for 500 points' })
    await user.click(confirmButton)
    // In flight: button shows a loading state and is disabled.
    await vi.waitFor(() => expect(confirmButton).toBeDisabled())
    // A second click cannot start another purchase: the confirm button is
    // disabled while in flight, so the click never reaches the handler.
    fireEvent.click(confirmButton)
    release({ costPoints: 500, themeId: 'theme.shop.space' })
    await vi.waitFor(() => expect(purchaseMock).toHaveBeenCalledTimes(1))
  })

  it('surfaces a child-readable error when the purchase fails', async () => {
    const user = userEvent.setup()
    purchaseMock.mockRejectedValueOnce(new Error('You need 200 more points to buy this theme.'))
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    await user.click(within(focus).getByRole('button', { name: 'Unlock for 500 points' }))
    await vi.waitFor(() => expect(within(focus).getByRole('alert')).toHaveTextContent(/more points/))
    // Nothing was applied after a failed purchase.
    expect(updateThemeMock).not.toHaveBeenCalled()
  })

  it('shows the shopping-disabled notice when a parent turned the shop off', async () => {
    const user = userEvent.setup()
    setStore({ familyData: { id: 'family-1', engagementPreferences: { themeShoppingEnabled: false } } })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).getByText('Theme shopping is turned off right now.')).toBeInTheDocument()
    expect(within(focus).queryByRole('button', { name: /Buy for/ })).not.toBeInTheDocument()
  })
})

describe('ThemeShop — insufficient balance (production regression)', () => {
  beforeEach(() => {
    storeListeners.clear()
    purchaseMock.mockClear()
    purchaseMock.mockImplementation(async () => ({ costPoints: 500, themeId: 'theme.shop.space' }))
    updateThemeMock.mockClear()
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    resetExperienceState()
    localStorage.clear()
  })

  it('balance 487 / price 500 → preview allowed, no buy CTA, states the 13-point gap', async () => {
    const user = userEvent.setup()
    setStore({ ...BASE_STORE, currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 487 } })
    renderShop()

    // The card still shows the real theme visual — preview is never gated.
    expect(screen.getByTestId('theme-preview-theme.shop.space')).toBeInTheDocument()
    expect(screen.getByTestId('theme-preview-theme.shop.space')).toHaveAttribute('data-preview-kind', 'painted')

    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')

    // Preview open, buy affordance replaced by the exact shortfall.
    expect(within(focus).getByTestId('theme-preview-theme.shop.space')).toBeInTheDocument()
    expect(within(focus).queryByRole('button', { name: /Buy for/ })).not.toBeInTheDocument()
    const shortfall = within(focus).getByTestId('theme-purchase-shortfall')
    expect(shortfall).toHaveTextContent('Need 13 more points')
    expect(shortfall).toHaveTextContent('487')

    // And the purchase pipeline is never reached.
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('a shortfall can never be bought even if the CTA is forced (no doomed transaction)', async () => {
    const user = userEvent.setup()
    setStore({ ...BASE_STORE, currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 499 } })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).getByTestId('theme-purchase-shortfall')).toHaveTextContent('Need 1 more point')
    expect(purchaseMock).not.toHaveBeenCalled()
    expect(updateThemeMock).not.toHaveBeenCalled()
  })

  it('balance 500 / price 500 → buyable, sheet shows 0 points remaining', async () => {
    const user = userEvent.setup()
    setStore({ ...BASE_STORE, currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 500 } })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).queryByTestId('theme-purchase-shortfall')).not.toBeInTheDocument()
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    const confirm = within(focus).getByTestId('purchase-confirmation')
    expect(within(confirm).getByTestId('sheet-balance')).toHaveTextContent('500 points')
    expect(within(confirm).getByTestId('sheet-after')).toHaveTextContent('0 points')
  })

  it('balance 501 / price 500 → buyable, sheet shows 1 point remaining', async () => {
    const user = userEvent.setup()
    setStore({ ...BASE_STORE, currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 501 } })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    await user.click(within(focus).getByRole('button', { name: 'Buy for 500 points' }))
    const confirm = within(focus).getByTestId('purchase-confirmation')
    expect(within(confirm).getByTestId('sheet-after')).toHaveTextContent('1 point')
  })

  it('flips an already-open card from Buy to Apply when ownership hydrates late', async () => {
    // The purchase projection is a BACKGROUND bootstrap listener, so a card
    // can be opened a moment before ownership arrives. The open panel must
    // re-read the live projection — a frozen snapshot showed "Buy" for a
    // theme the child already owned, and the transaction then refused.
    const user = userEvent.setup()
    setStore({ themePurchases: [] })
    renderShop()

    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).getByRole('button', { name: /Buy for/ })).toBeInTheDocument()

    // Ownership lands: the per-child mirror shape (no childId field).
    act(() => {
      setStore({ themePurchases: [{ id: 'space', shopItemId: 'space', themeId: 'theme.shop.space', costPoints: 500 }] })
    })

    expect(within(focus).getByRole('button', { name: 'Use this theme' })).toBeInTheDocument()
    expect(within(focus).queryByRole('button', { name: /Buy for/ })).not.toBeInTheDocument()
  })

  it('an owned theme needs no balance at all', async () => {
    const user = userEvent.setup()
    setStore({
      ...BASE_STORE,
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null, rewardPoints: 0 },
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
    })
    renderShop()
    await user.click(screen.getByTestId('theme-card-space'))
    const focus = screen.getByTestId('theme-shop-focus')
    expect(within(focus).getByRole('button', { name: 'Use this theme' })).toBeInTheDocument()
    expect(within(focus).queryByTestId('theme-purchase-shortfall')).not.toBeInTheDocument()
  })
})
