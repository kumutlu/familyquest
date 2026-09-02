/**
 * Theme-token application tests for `ChildExperienceShell`.
 *
 * Pins the visual acceptance contract for the seasonal world:
 *   - `--qk-theme-accent`, `--qk-theme-ambient-from/to`,
 *     `--qk-theme-pattern-density` and the new
 *     `--qk-theme-accent-soft` token cascade through the world wrapper.
 *   - The base world stays calm when no tokens are emitted (no pattern
 *     density, no accent soft).
 *   - Seasonal worlds surface a distinct, higher-density pattern token
 *     so the world change is visually readable (≈1 second glance test).
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChildExperienceShell } from './ChildExperienceShell'

describe('ChildExperienceShell — theme token application', () => {
  it('renders a calm base wrapper when no theme is provided', () => {
    const { container } = render(
      <ChildExperienceShell resolvedTheme={null} mascotPresentation={null}>
        <div data-testid="child" />
      </ChildExperienceShell>,
    )
    const wrapper = container.querySelector('[data-testid="child-experience-shell"]')
    expect(wrapper).toBeInTheDocument()
    // No inline style means no ambient tokens were emitted \u2014 the base
    // world stays calm.
    expect(wrapper?.getAttribute('style') ?? '').toBe('')
    expect(wrapper?.getAttribute('data-experience-theme-kind')).toBe('base')
  })

  it('cascades seasonal tokens to the wrapper inline style', () => {
    const { container } = render(
      <ChildExperienceShell
        resolvedTheme={
          {
            weeklyEvent: null,
            seasonalEvent: { id: 's' },
            theme: {
              tokens: {
                accent: '#dc2626',
                accentSoft: '#f87171',
                ambientFrom: '#7f1d1d',
                ambientTo: '#fff7ed',
                patternDensity: 0.8,
              },
            },
          } as any
        }
        mascotPresentation={null}
      >
        <div />
      </ChildExperienceShell>,
    )
    const wrapper = container.querySelector('[data-testid="child-experience-shell"]')
    expect(wrapper).toBeInTheDocument()
    const style = wrapper?.getAttribute('style') ?? ''
    expect(style).toContain('--qk-theme-accent: #dc2626')
    expect(style).toContain('--qk-theme-accent-soft: #f87171')
    expect(style).toContain('--qk-theme-ambient-from: #7f1d1d')
    expect(style).toContain('--qk-theme-ambient-to: #fff7ed')
    expect(style).toContain('--qk-theme-pattern-density: 0.8')
    expect(wrapper?.getAttribute('data-experience-theme-kind')).toBe('seasonal')
  })

  it('falls back to accent when accentSoft is omitted so seasonal worlds still read as different', () => {
    const { container } = render(
      <ChildExperienceShell
        resolvedTheme={
          {
            weeklyEvent: null,
            seasonalEvent: { id: 's' },
            theme: {
              tokens: {
                accent: '#7c3aed',
                ambientFrom: '#1f2937',
                ambientTo: '#fde68a',
                patternDensity: 0.7,
              },
            },
          } as any
        }
        mascotPresentation={null}
      >
        <div />
      </ChildExperienceShell>,
    )
    const wrapper = container.querySelector('[data-testid="child-experience-shell"]')
    const style = wrapper?.getAttribute('style') ?? ''
    expect(style).toContain('--qk-theme-accent-soft: #7c3aed')
  })
})