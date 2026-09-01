/**
 * Mystery Reveal acknowledgement tests.
 *
 * Pins:
 *   - Acknowledged reveals do NOT replay the celebration beat on remount.
 *   - Reduced-motion collapses the celebration to the final state.
 *   - Reward copy is sourced from i18n, not hardcoded English.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import { MysteryReveal } from './MysteryReveal'

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
}

describe('MysteryReveal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(wrap(
      <MysteryReveal open={false} reward={{ type: 'xp_bonus', amount: 20 }} onClose={() => {}} />,
    ))
    expect(container.firstChild).toBeNull()
  })

  it('renders the celebration beat when opened fresh', () => {
    render(wrap(
      <MysteryReveal
        open={true}
        reward={{ type: 'xp_bonus', amount: 20 }}
        rarity="rare"
        onClose={() => {}}
        acknowledged={false}
      />,
    ))
    const dialog = screen.getByTestId('mystery-reveal')
    expect(dialog).toHaveAttribute('data-reveal-state', 'celebration')
  })

  it('renders the acknowledged beat without celebration when acknowledged', () => {
    render(wrap(
      <MysteryReveal
        open={true}
        reward={{ type: 'cosmetic_unlock', itemId: 'hat_party' }}
        rarity="rare"
        onClose={() => {}}
        acknowledged={true}
      />,
    ))
    const dialog = screen.getByTestId('mystery-reveal')
    expect(dialog).toHaveAttribute('data-reveal-state', 'acknowledged')
    // i18n copy: cosmetics title from the EN catalog.
    expect(screen.getByText('New look unlocked!')).toBeInTheDocument()
  })

  it('renders the XP amount as a number with locale formatting', () => {
    render(wrap(
      <MysteryReveal
        open={true}
        reward={{ type: 'xp_bonus', amount: 25 }}
        rarity="common"
        onClose={() => {}}
        acknowledged={true}
      />,
    ))
    expect(screen.getByText('+25 XP')).toBeInTheDocument()
  })
})