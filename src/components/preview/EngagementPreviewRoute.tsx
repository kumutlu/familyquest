/**
 * `EngagementPreviewRoute` — DEV/TEST-only fixture browser.
 *
 * Renders a series of engagement surface states so QA can verify
 * precedence, mystery ready/locked, comeback tiers, seasonal accents,
 * XP feedback, and reduced motion without touching authoritative state.
 *
 * URL CONTRACT (see ./engagementPreviewUrl.ts)
 * --------------------------------------------
 *   INDEX_URL   = ?dev-preview=engagement
 *   FIXTURE_URL = ?dev-preview=engagement&fixture=<id>
 *
 * The marker is ALWAYS preserved by `buildEngagementPreviewUrl`. A click
 * in the index navigates via `history.pushState` to the corresponding
 * fixture URL. The marker can never be silently dropped, so the preview
 * can never fall through to the normal `App` graph (Firebase Auth,
 * AuthRoutingGate, ProfileGate, FamilyGate, onboarding, Firestore).
 *
 * SAFETY
 * ------
 * - Activated ONLY when `import.meta.env.PROD === false`.
 * - When the production build is in scope, the function returns `null`
 *   and the route is unreachable.
 * - The component performs NO Firestore writes, NO XP writes, NO point
 *   writes, NO wallet writes, NO inventory writes, NO task completion
 *   writes. Everything is fixture data.
 * - A pinned test asserts the production guard is intact.
 * - Every fixture render path is wrapped in `EngagementPreviewErrorBoundary`
 *   so a render failure surfaces a diagnostic panel INSTEAD of a blank
 *   page.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n';
import { ChildExperienceShell } from '../experience/ChildExperienceShell';
import { MascotScene } from '../experience/MascotScene';
import { YourJourney } from '../experience/YourJourney';
import { QuestTileList } from '../experience/QuestTile';
import { TodaysAdventureCenterpiece } from '../experience/TodaysAdventureCenterpiece';
import {
  buildEngagementPreviewUrl,
  isDevPreviewQueryActive,
  parseFixtureFromSearch,
} from './engagementPreviewUrl';
import {
  PREVIEW_FIXTURES as FIXTURES,
  findFixtureById,
  type PreviewFixture,
  type PreviewFixtureKind,
} from './previewFixtures';
export type { PreviewFixture };

declare const importMetaEnv: { PROD?: boolean } | undefined;

function isProductionBuild(): boolean {
  // Vite injects `import.meta.env.PROD` at build time. We read it via
  // a small helper so the test can monkey-patch the underlying flag
  // without forking Vite. When running under vitest the env is faked.
  try {
    // Lazy access keeps SSR/harness consumers safe.
    const env = (import.meta as any)?.env;
    if (env && typeof env.PROD === 'boolean') return env.PROD;
  } catch {
    // ignore — fall through to default.
  }
  return typeof importMetaEnv !== 'undefined'
    ? importMetaEnv.PROD === true
    : false;
}

/**
 * Hook-style helper used by the host (`ChildLivingHome`). Returns the
 * preview surface when the user is on the dev route AND the build is
 * not production. Returns `null` otherwise.
 *
 * Implementation detail: this is a thin wrapper component so React
 * hooks can be called inline. The function name is lowercase so Fast
 * Refresh does not promote it to a refresh boundary.
 */
function DevOnlyPreviewRoute(): React.ReactNode {
  const enabled = useIsPreviewEnabled()
  if (!enabled) return null
  return <EngagementPreviewSurface />
}

// eslint-disable-next-line react-refresh/only-export-components -- named export for the dev harness; the component is the default refresh boundary
export { DevOnlyPreviewRoute as unstable_DevOnlyPreviewRoute }

function useIsPreviewEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(false)

  useEffect(() => {
    if (isProductionBuild()) {
      setEnabled(false)
      return
    }
    if (typeof window === 'undefined') {
      setEnabled(false)
      return
    }
    const apply = () => {
      setEnabled(isDevPreviewQueryActive(window.location?.search ?? ''))
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  return enabled
}

interface PreviewNavigationApi {
  readonly navigateToFixture: (fixtureId: string) => void
  readonly navigateToIndex: () => void
}

/**
 * Use the URL as the single source of truth for fixture selection.
 *
 * - `pushState` is used so browser Back / Forward work normally.
 * - The new URL is always produced via `buildEngagementPreviewUrl`, so
 *   the dev-preview marker is preserved across every navigation.
 * - Both `pushState` and a manual `popstate` event are dispatched so
 *   React's URL observers re-evaluate on the same tick (Safari does not
 *   fire `popstate` after `pushState`).
 */
function usePreviewNavigation(): {
  fixtureId: string | null
  navigation: PreviewNavigationApi
} {
  const readFixtureFromUrl = useCallback((): string | null => {
    if (typeof window === 'undefined') return null
    if (!isDevPreviewQueryActive(window.location?.search ?? '')) return null
    return parseFixtureFromSearch(window.location?.search ?? '')
  }, [])

  const [fixtureId, setFixtureId] = useState<string | null>(() =>
    readFixtureFromUrl(),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => {
      // If the marker is gone we must NOT render the preview.
      if (!isDevPreviewQueryActive(window.location?.search ?? '')) {
        setFixtureId(null)
        return
      }
      setFixtureId(parseFixtureFromSearch(window.location?.search ?? ''))
    }
    window.addEventListener('popstate', sync)
    // Some browsers (and Safari in particular) also dispatch this when
    // history.pushState is called from JS.
    window.addEventListener('pushstate' as any, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('pushstate' as any, sync)
    }
  }, [])

  const navigation = useMemo<PreviewNavigationApi>(() => {
    const goTo = (next: string | null): void => {
      if (typeof window === 'undefined') return
      const currentSearch = window.location?.search ?? ''
      const url = buildEngagementPreviewUrl(next, { currentSearch })
      // Use the path with the rebuilt search; never touch the hash so we
      // do not accidentally scroll-jump.
      const nextHref = `${window.location.pathname}${url}${window.location.hash ?? ''}`
      // Push a new entry so browser Back returns to the previous surface.
      window.history.pushState({}, '', nextHref)
      // Manually re-evaluate because pushState does NOT fire popstate.
      setFixtureId(next)
      // Dispatch a synthetic event so other observers can react.
      try {
        window.dispatchEvent(new PopStateEvent('popstate'))
      } catch {
        // ignore — Safari has emitted warnings on PopStateEvent in older
        // versions; the manual setFixtureId above is the canonical update.
      }
    }
    return {
      navigateToFixture: (id: string) => goTo(id),
      navigateToIndex: () => goTo(null),
    }
  }, [])

  return { fixtureId, navigation }
}

function EngagementPreviewSurface() {
  const { fixtureId, navigation } = usePreviewNavigation()
  const fixture = findFixtureById(fixtureId)
  // Unknown ids fall through to a safe diagnostic panel; the preview
  // shell is still visible so the user is never trapped on a blank page.
  if (fixture === null) {
    if (fixtureId !== null) {
      return (
        <section
          data-testid="engagement-preview-unknown"
          className="rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-4"
        >
          <header className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-card-title qk-text-primary">
              Unknown fixture
            </h2>
            <button
              type="button"
              data-testid="engagement-preview-back"
              onClick={navigation.navigateToIndex}
              className="rounded-full qk-bg-inset px-3 py-1 text-meta qk-text-secondary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
            >
              Back to fixtures
            </button>
          </header>
          <p
            data-testid="engagement-preview-unknown-id"
            className="text-meta qk-text-secondary"
          >
            Unknown fixture id: {fixtureId}
          </p>
        </section>
      )
    }
    return (
      <section
        data-testid="engagement-preview-index"
        className="rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-4"
      >
        <h2 className="text-card-title qk-text-primary">Engagement preview</h2>
        <p className="mt-1 text-meta qk-text-secondary">
          Dev-only fixture browser. Pick a fixture to inspect it.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FIXTURES.map(f => (
            <li key={f.id}>
              <button
                type="button"
                data-testid={`engagement-preview-${f.id}`}
                onClick={() => navigation.navigateToFixture(f.id)}
                className="w-full rounded-card qk-bg-inset px-3 py-2 text-left text-card-title qk-text-primary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
              >
                {f.title}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section
      data-testid={`engagement-preview-frame-${fixture.id}`}
      data-fixture-kind={fixture.kind}
      className="rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-4"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-card-title qk-text-primary">{fixture.title}</h2>
        <button
          type="button"
          onClick={navigation.navigateToIndex}
          data-testid="engagement-preview-back"
          className="rounded-full qk-bg-inset px-3 py-1 text-meta qk-text-secondary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
        >
          Back to fixtures
        </button>
      </header>
      <EngagementPreviewErrorBoundary
        fixtureId={fixture.id}
        onNavigateToIndex={navigation.navigateToIndex}
      >
        <PreviewFixtureCanvas fixture={fixture} />
      </EngagementPreviewErrorBoundary>
    </section>
  )
}

/**
 * Fixture-only preview hero block. Mirrors the visual hierarchy of the
 * production Child Home hero so QA can judge the relationship between
 * XP / Level / Streak / Character + Mascot without an authenticated
 * session. Numbers are deterministic and have no production authority.
 */
function PreviewHeroBlock({ fixture }: { fixture: PreviewFixture }) {
  const { t } = useTranslation('home')
  const xp = HERO_XP_FOR[fixture.kind]
  const level = HERO_LEVEL_FOR[fixture.kind]
  const streak = HERO_STREAK_FOR[fixture.kind]
  return (
    <section
      data-testid="preview-hero"
      data-fixture-id={fixture.id}
      className="relative overflow-hidden rounded-hero py-6 px-5 text-white"
      style={{
        background:
          'linear-gradient(135deg, var(--qk-surface-hero-from), var(--qk-surface-hero-to))',
      }}
    >
      <div className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-2xl font-extrabold backdrop-blur-sm"
        >
          {String(fixture.title ?? '·').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-extrabold">
            {t('child.greeting', { name: 'Preview' })}
          </h1>
          <p className="mt-0.5 text-meta opacity-80">
            {t('child.heroSubtitle')}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="hidden max-sm:hidden sm:flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-2xl font-extrabold"
        >
          🐾
        </span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2" data-testid="preview-hero-xp">
        <div className="rounded-card bg-white/10 px-3 py-2 backdrop-blur-sm">
          <p className="text-meta uppercase tracking-wide opacity-70">XP</p>
          <p className="text-balance font-extrabold tabular-nums">{xp}</p>
        </div>
        <div className="rounded-card bg-white/10 px-3 py-2 backdrop-blur-sm">
          <p className="text-meta uppercase tracking-wide opacity-70">Level</p>
          <p className="text-balance font-extrabold tabular-nums">{level}</p>
        </div>
        <div className="rounded-card bg-white/10 px-3 py-2 backdrop-blur-sm">
          <p className="text-meta uppercase tracking-wide opacity-70">Streak</p>
          <p className="text-balance font-extrabold tabular-nums">{streak}🔥</p>
        </div>
      </div>
    </section>
  )
}

// Fixture-only hero numbers. Deterministic per kind so QA can spot
// regressions easily.
const HERO_XP_FOR: Record<PreviewFixtureKind, number> = {
  'normal-quests': 320,
  'normal-all-caught-up': 540,
  surge: 410,
  'mystery-locked': 280,
  'mystery-ready': 360,
  'mystery-reveal': 510,
  'comeback-1d': 200,
  'comeback-3d': 150,
  'comeback-7d': 100,
  'seasonal-christmas': 470,
  'seasonal-halloween': 460,
  'seasonal-ramadan-eid': 420,
  'seasonal-neon': 500,
  'xp-pop-mystery': 360,
  'xp-pop-comeback': 220,
  'reduced-motion': 300,
}
const HERO_LEVEL_FOR: Record<PreviewFixtureKind, number> = {
  'normal-quests': 4,
  'normal-all-caught-up': 5,
  surge: 4,
  'mystery-locked': 3,
  'mystery-ready': 4,
  'mystery-reveal': 5,
  'comeback-1d': 2,
  'comeback-3d': 2,
  'comeback-7d': 1,
  'seasonal-christmas': 5,
  'seasonal-halloween': 5,
  'seasonal-ramadan-eid': 4,
  'seasonal-neon': 5,
  'xp-pop-mystery': 4,
  'xp-pop-comeback': 2,
  'reduced-motion': 3,
}
const HERO_STREAK_FOR: Record<PreviewFixtureKind, number> = {
  'normal-quests': 3,
  'normal-all-caught-up': 7,
  surge: 5,
  'mystery-locked': 2,
  'mystery-ready': 4,
  'mystery-reveal': 6,
  'comeback-1d': 1,
  'comeback-3d': 0,
  'comeback-7d': 0,
  'seasonal-christmas': 6,
  'seasonal-halloween': 5,
  'seasonal-ramadan-eid': 4,
  'seasonal-neon': 7,
  'xp-pop-mystery': 4,
  'xp-pop-comeback': 0,
  'reduced-motion': 2,
}

function PreviewFixtureCanvas({ fixture }: { fixture: PreviewFixture }) {
  // Render the SAME productized composition the production surface uses,
  // wrapped in the experience shell, so QA judges visual hierarchy, theme,
  // mascot, Adventure, quests and XP relationship — not isolated text rows.
  // MemoryRouter is included so YourJourney can resolve navigation.
  const world = (
    <MemoryRouter>
      <ChildExperienceShell
        resolvedTheme={fixtureThemeFor(fixture)}
        mascotPresentation={{
          characterId: 'queki',
          mood: fixture.mood,
          expression: fixture.expression,
          messageKey: fixture.messageKey,
        }}
      >
        <div
          className="space-y-5"
          data-testid={`preview-composition-${fixture.id}`}
        >
          <PreviewHeroBlock fixture={fixture} />
          <MascotScene
            presentation={{
              characterId: 'queki',
              mood: fixture.mood,
              expression: fixture.expression,
              messageKey: fixture.messageKey,
            }}
            message={fixture.mascotLine}
            greeting="Hey, preview"
          />
          <TodaysAdventureCenterpiece
            presentation={fixture.adventurePresentation}
            mysteryDrop={fixture.mysteryDrop}
            comeback={fixture.comeback}
            surge={fixture.surge}
            normalQuestCount={fixture.normalQuestCount}
            allCaughtUp={fixture.allCaughtUp}
            onOpen={() => {}}
            onSelectSurgeTask={() => {}}
            onViewQuests={() => {}}
          />
          <QuestTileList
            quests={fixture.quests}
            onPressQuest={() => {}}
            onViewAll={() => {}}
          />
          <YourJourney
            familyData={{ petBoxEnabled: true }}
            previewData={fixture.longTermPreview ?? null}
          />
        </div>
      </ChildExperienceShell>
    </MemoryRouter>
  )
  return <I18nextProvider i18n={i18n}>{world}</I18nextProvider>
}

// Resolve the fixture's presentation bundle so the canvas can render real
// components. All values come from fixture data — never invented at runtime.
// We deliberately raise pattern density + supply an accentSoft so each
// seasonal world reads as visibly different from the calm base state
// (≈1 second glance test) without recolouring every component.
function fixtureThemeFor(fixture: PreviewFixture) {
  if (fixture.kind === 'seasonal-neon') {
    return {
      theme: {
        tokens: {
          accent: '#06b6d4',
          accentSoft: '#22d3ee',
          ambientFrom: '#0f172a',
          ambientTo: '#1e1b4b',
          patternDensity: 0.85,
        },
      },
    } as any
  }
  if (fixture.kind === 'seasonal-christmas') {
    return {
      theme: {
        tokens: {
          accent: '#dc2626',
          accentSoft: '#f87171',
          ambientFrom: '#7f1d1d',
          ambientTo: '#fff7ed',
          patternDensity: 0.75,
        },
      },
    } as any
  }
  if (fixture.kind === 'seasonal-halloween') {
    return {
      theme: {
        tokens: {
          accent: '#7c3aed',
          accentSoft: '#a78bfa',
          ambientFrom: '#1f2937',
          ambientTo: '#fde68a',
          patternDensity: 0.7,
        },
      },
    } as any
  }
  if (fixture.kind === 'seasonal-ramadan-eid') {
    return {
      theme: {
        tokens: {
          accent: '#059669',
          accentSoft: '#34d399',
          ambientFrom: '#064e3b',
          ambientTo: '#ecfdf5',
          patternDensity: 0.7,
        },
      },
    } as any
  }
  return { theme: { tokens: {} } } as any
}

/**
 * Narrow DEV-only error boundary that wraps each fixture render so a
 * render failure in any single fixture produces a visible
 * "Preview failed to render" message INSTEAD of a blank screen.
 *
 * The boundary is intentionally per-fixture: an earlier fixture failure
 * does not prevent navigation to a healthy one.
 */
interface PreviewErrorBoundaryProps {
  readonly fixtureId: string
  readonly children: React.ReactNode
  readonly onNavigateToIndex: () => void
}

interface PreviewErrorBoundaryState {
  readonly error: Error | null
}

class EngagementPreviewErrorBoundary extends React.Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // Surface to the dev console but never to the production error reporter.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console -- DEV-only diagnostic surface
      console.error('[engagement-preview] fixture render failed', {
        fixtureId: this.props.fixtureId,
        message: error?.message,
        componentStack: info?.componentStack ?? null,
      })
    }
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    const dev = !isProductionBuild()
    return (
      <div
        role="alert"
        data-testid="engagement-preview-error"
        className="rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-4"
      >
        <h2 className="text-card-title qk-text-primary">
          Preview failed to render
        </h2>
        <p className="mt-1 text-meta qk-text-secondary">
          The fixture browser caught an error. Switch back to the index and pick
          another fixture, or retry the same one.
        </p>
        {dev ? (
          <pre
            data-testid="engagement-preview-error-details"
            className="mt-3 max-h-48 overflow-auto rounded qk-bg-inset p-2 text-meta qk-text-secondary"
          >
            {String(error?.message ?? 'unknown')}
            {'\n'}
            {String(error?.stack ?? '')}
          </pre>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-testid="engagement-preview-error-retry"
            onClick={this.handleReset}
            className="rounded-full qk-bg-inset px-3 py-1 text-meta qk-text-secondary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
          >
            Retry fixture
          </button>
          <button
            type="button"
            data-testid="engagement-preview-error-back"
            onClick={this.props.onNavigateToIndex}
            className="rounded-full qk-bg-inset px-3 py-1 text-meta qk-text-secondary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
          >
            Back to fixtures
          </button>
        </div>
      </div>
    )
  }
}

/**
 * Surface wrapped in the narrow DEV-only error boundary. This is the
 * component `App.tsx` mounts at the top level when the URL carries
 * `?dev-preview=engagement` AND the build is not production.
 *
 * Returns `null` (unreachable) when:
 *   - `import.meta.env.PROD === true`
 *   - The URL does not carry the `dev-preview=engagement` query
 *
 * In every other case it renders the fixture browser.
 */
function DevPreviewRoot(): React.ReactNode {
  if (isProductionBuild()) return null
  if (typeof window === 'undefined') return null
  if (!isDevPreviewQueryActive(window.location?.search ?? '')) return null
  // The preview chrome uses generous vertical padding so the DEV
  // banner and the fixture composition do not visually collide with
  // the product mascot / hero block. Production mascot positioning is
  // intentionally untouched — only the dev shell is widened here.
  return (
    <div
      data-testid="engagement-preview-root"
      className="min-h-screen w-full bg-gray-50 px-4 py-10 text-gray-900 dark:bg-[#0e1116] dark:text-gray-100"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <header
          data-testid="engagement-preview-chrome"
          className="space-y-1 border-b border-gray-200 pb-6 dark:border-gray-800"
        >
          <p className="text-meta uppercase tracking-wide opacity-70">
            DEV preview
          </p>
          <h1 className="text-page-title font-semibold">
            Engagement experience preview
          </h1>
          <p className="text-meta opacity-80">
            Fixture-only visual QA harness. No Firestore reads or writes.
          </p>
        </header>
        <EngagementPreviewSurface />
        <footer className="border-t border-gray-200 pt-4 text-meta opacity-60 dark:border-gray-800">
          <a
            href="/"
            data-testid="engagement-preview-exit"
            className="underline hover:opacity-100"
          >
            Exit preview (return to Queki)
          </a>
        </footer>
      </div>
    </div>
  )
}

export {
  EngagementPreviewSurface,
  EngagementPreviewErrorBoundary,
  DevPreviewRoot,
}
export default EngagementPreviewSurface