/**
 * Production-guard tests for `EngagementPreviewRoute`.
 *
 * Pinning rules:
 *   - The preview surface MUST be unreachable in production builds.
 *   - The preview surface MUST NOT perform Firestore / XP / points /
 *     wallet / inventory / task-completion writes.
 *   - The preview surface MUST only render when the URL carries the
 *     `dev-preview=engagement` query.
 *   - Click navigation MUST preserve the `dev-preview=engagement`
 *     marker so the preview can never fall into the normal app graph.
 *   - A throwing fixture MUST surface the error boundary, NOT a blank
 *     page.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DevPreviewRoot,
  EngagementPreviewErrorBoundary,
  EngagementPreviewSurface,
} from './EngagementPreviewRoute'
import { findFixtureById } from './previewFixtures'
import {
  buildEngagementPreviewUrl,
  isDevPreviewQueryActive,
} from './engagementPreviewUrl'

describe('EngagementPreviewRoute — production guard', () => {
  it('renders the fixture index when the dev route is on and PROD=false', async () => {
    window.history.pushState({}, '', '/?dev-preview=engagement')
    render(<EngagementPreviewSurface />)
    expect(await screen.findByTestId('engagement-preview-index')).toBeInTheDocument()
  })

  it('exposes every required fixture kind', () => {
    const ids = [
      'normal-quests',
      'normal-all-caught-up',
      'surge',
      'mystery-locked',
      'mystery-ready',
      'mystery-reveal',
      'comeback-1d',
      'comeback-3d',
      'comeback-7d',
      'seasonal-christmas',
      'seasonal-halloween',
      'seasonal-ramadan-eid',
      'seasonal-neon',
      'xp-pop-mystery',
      'xp-pop-comeback',
      'reduced-motion',
    ]
    for (const id of ids) {
      expect(findFixtureById(id)?.id).toBe(id)
    }
  })

  it('renders the top-level DevPreviewRoot in DEV when the URL carries the query', async () => {
    window.history.pushState({}, '', '/?dev-preview=engagement')
    const { container } = render(<DevPreviewRoot />)
    expect(
      container.querySelector('[data-testid="engagement-preview-root"]'),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('engagement-preview-index')).toBeInTheDocument()
  })

  it('DevPreviewRoot returns null when the URL does not carry the dev-preview query', () => {
    window.history.pushState({}, '', '/')
    const { container } = render(<DevPreviewRoot />)
    expect(
      container.querySelector('[data-testid="engagement-preview-root"]'),
    ).not.toBeInTheDocument()
  })

  it('DevPreviewRoot returns null in production (import.meta.env.PROD === true)', () => {
    vi.stubEnv('PROD', true)
    try {
      window.history.pushState({}, '', '/?dev-preview=engagement')
      const { container } = render(<DevPreviewRoot />)
      expect(
        container.querySelector('[data-testid="engagement-preview-root"]'),
      ).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('DevPreviewRoot returns null when the URL carries an unknown preview marker value', () => {
    window.history.pushState({}, '', '/?dev-preview=other')
    const { container } = render(<DevPreviewRoot />)
    expect(
      container.querySelector('[data-testid="engagement-preview-root"]'),
    ).not.toBeInTheDocument()
  })
})

describe('EngagementPreviewRoute — click navigation preserves the preview marker', () => {
  it('clicking "Mystery · ready" preserves dev-preview=engagement in the URL', async () => {
    window.history.pushState({}, '', '/?dev-preview=engagement')
    render(<EngagementPreviewSurface />)
    const trigger = await screen.findByTestId('engagement-preview-mystery-ready')
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-testid="engagement-preview-frame-mystery-ready"]',
        ),
      ).toBeInTheDocument()
    })
    expect(isDevPreviewQueryActive(window.location.search)).toBe(true)
    expect(window.location.search).toBe(
      '?dev-preview=engagement&fixture=mystery-ready',
    )
  })

  it('clicking the Back button returns to the index URL while keeping the marker', async () => {
    window.history.pushState(
      {},
      '',
      '/?dev-preview=engagement&fixture=mystery-ready',
    )
    render(<EngagementPreviewSurface />)
    await screen.findByTestId('engagement-preview-frame-mystery-ready')
    const back = screen.getByTestId('engagement-preview-back')
    fireEvent.click(back)
    await waitFor(() => {
      expect(
        screen.getByTestId('engagement-preview-index'),
      ).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?dev-preview=engagement')
  })

  it('switching fixture from index → Mystery Ready → Surge preserves the marker at every step', async () => {
    window.history.pushState({}, '', '/?dev-preview=engagement')
    render(<EngagementPreviewSurface />)
    fireEvent.click(await screen.findByTestId('engagement-preview-mystery-ready'))
    await waitFor(() => {
      expect(
        screen.getByTestId('engagement-preview-frame-mystery-ready'),
      ).toBeInTheDocument()
    })
    // Switch directly using the URL helper (simulating a fast user).
    const nextUrl = buildEngagementPreviewUrl('surge', { currentSearch: window.location.search })
    window.history.pushState({}, '', nextUrl)
    // Synthesize the popstate the preview listens for.
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => {
      expect(
        screen.getByTestId('engagement-preview-frame-surge'),
      ).toBeInTheDocument()
    })
    expect(isDevPreviewQueryActive(window.location.search)).toBe(true)
    expect(window.location.search).toBe('?dev-preview=engagement&fixture=surge')
  })

  it('an unknown fixture id renders a safe fallback surface (NOT a blank page)', async () => {
    window.history.pushState(
      {},
      '',
      '/?dev-preview=engagement&fixture=does-not-exist',
    )
    render(<EngagementPreviewSurface />)
    const unknown = await screen.findByTestId('engagement-preview-unknown')
    expect(unknown).toBeInTheDocument()
    expect(
      screen.getByTestId('engagement-preview-unknown-id'),
    ).toHaveTextContent('does-not-exist')
    // The preview shell must STILL be present.
    expect(screen.getByTestId('engagement-preview-back')).toBeInTheDocument()
  })

  it('opening the surface directly on a fixture URL renders the fixture (deep-link safe)', async () => {
    window.history.pushState(
      {},
      '',
      '/?dev-preview=engagement&fixture=comeback-7d',
    )
    render(<EngagementPreviewSurface />)
    expect(
      await screen.findByTestId('engagement-preview-frame-comeback-7d'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('preview-comeback-7d'),
    ).toHaveTextContent('Comeback · return_7d · +50 XP')
  })
})

describe('EngagementPreviewRoute — error boundary', () => {
  // Silence the React/console.error noise from intentional fixture throws.
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  // A deliberately throwing test fixture is mounted through the public
  // surface so the boundary can be exercised in isolation. We render it
  // through the boundary directly because PreviewFixtureCanvas is internal.
  function ThrowingChild(): React.ReactNode {
    throw new Error('boom')
  }
  it('renders "Preview failed to render" when a fixture throws, NOT a blank page', () => {
    const { container } = render(
      <EngagementPreviewErrorBoundary
        fixtureId="test-throw"
        onNavigateToIndex={() => undefined}
      >
        <ThrowingChild />
      </EngagementPreviewErrorBoundary>,
    )
    expect(
      container.querySelector('[data-testid="engagement-preview-error"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-testid="engagement-preview-error-retry"]'),
    ).toBeInTheDocument()
  })

  it('does not expose the stack trace in production builds', () => {
    vi.stubEnv('PROD', true)
    try {
      const { container } = render(
        <EngagementPreviewErrorBoundary
          fixtureId="test-throw"
          onNavigateToIndex={() => undefined}
        >
          <ThrowingChild />
        </EngagementPreviewErrorBoundary>,
      )
      expect(
        container.querySelector('[data-testid="engagement-preview-error-details"]'),
      ).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does expose the stack trace in DEV for fast debugging', () => {
    const { container } = render(
      <EngagementPreviewErrorBoundary
        fixtureId="test-throw"
        onNavigateToIndex={() => undefined}
      >
        <ThrowingChild />
      </EngagementPreviewErrorBoundary>,
    )
    const details = container.querySelector(
      '[data-testid="engagement-preview-error-details"]',
    )
    expect(details).toBeInTheDocument()
    expect(details?.textContent ?? '').toContain('boom')
  })
})