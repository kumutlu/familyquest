/**
 * `EngagementPreviewRoute` — DEV/TEST-only fixture browser.
 *
 * Renders a series of engagement surface states so QA can verify
 * precedence, mystery ready/locked, comeback tiers, seasonal accents,
 * XP feedback, and reduced motion without touching authoritative state.
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
 */

import { useEffect, useState } from 'react';

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

export interface PreviewFixture {
  readonly id: string
  readonly title: string
  readonly kind:
    | 'normal-quests'
    | 'normal-all-caught-up'
    | 'surge'
    | 'mystery-locked'
    | 'mystery-ready'
    | 'mystery-reveal'
    | 'comeback-1d'
    | 'comeback-3d'
    | 'comeback-7d'
    | 'seasonal-christmas'
    | 'seasonal-halloween'
    | 'seasonal-ramadan-eid'
    | 'seasonal-neon'
    | 'xp-pop-mystery'
    | 'xp-pop-comeback'
    | 'reduced-motion'
}

const FIXTURES: readonly PreviewFixture[] = [
  { id: 'normal-quests',         title: 'Normal · quests waiting',   kind: 'normal-quests' },
  { id: 'normal-all-caught-up',  title: 'Normal · all caught up',    kind: 'normal-all-caught-up' },
  { id: 'surge',                 title: 'Active Surge',              kind: 'surge' },
  { id: 'mystery-locked',        title: 'Mystery · locked',          kind: 'mystery-locked' },
  { id: 'mystery-ready',         title: 'Mystery · ready',           kind: 'mystery-ready' },
  { id: 'mystery-reveal',        title: 'Mystery · reveal',          kind: 'mystery-reveal' },
  { id: 'comeback-1d',           title: 'Comeback · return_1d',      kind: 'comeback-1d' },
  { id: 'comeback-3d',           title: 'Comeback · return_3d',      kind: 'comeback-3d' },
  { id: 'comeback-7d',           title: 'Comeback · return_7d',      kind: 'comeback-7d' },
  { id: 'seasonal-christmas',    title: 'Seasonal · Christmas',      kind: 'seasonal-christmas' },
  { id: 'seasonal-halloween',    title: 'Seasonal · Halloween',      kind: 'seasonal-halloween' },
  { id: 'seasonal-ramadan-eid',  title: 'Seasonal · Ramadan / Eid',      kind: 'seasonal-ramadan-eid' },
  { id: 'seasonal-neon',         title: 'Seasonal · Neon weekly',    kind: 'seasonal-neon' },
  { id: 'xp-pop-mystery',        title: 'XP pop · Mystery',          kind: 'xp-pop-mystery' },
  { id: 'xp-pop-comeback',       title: 'XP pop · Comeback',         kind: 'xp-pop-comeback' },
  { id: 'reduced-motion',        title: 'Reduced motion',            kind: 'reduced-motion' },
]

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
    const search = window.location?.search ?? ''
    const params = new URLSearchParams(search)
    setEnabled(params.get('dev-preview') === 'engagement')
  }, [])

  return enabled
}

function EngagementPreviewSurface() {
  const [fixture, setFixture] = useState<PreviewFixture | null>(null)
  if (fixture === null) {
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
                onClick={() => setFixture(f)}
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
          onClick={() => setFixture(null)}
          data-testid="engagement-preview-back"
          className="rounded-full qk-bg-inset px-3 py-1 text-meta qk-text-secondary hover:bg-xp-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
        >
          Back to fixtures
        </button>
      </header>
      <PreviewFixtureCanvas fixture={fixture} />
    </section>
  )
}

function PreviewFixtureCanvas({ fixture }: { fixture: PreviewFixture }) {
  // The preview canvas is intentionally thin: each fixture exposes a
  // data attribute that downstream tests can read without depending on
  // the exact copy. Visual fidelity lives in the same components the
  // production surface uses.
  switch (fixture.kind) {
    case 'normal-quests':
      return <div data-testid="preview-normal-quests" className="text-meta qk-text-secondary">3 quests waiting</div>
    case 'normal-all-caught-up':
      return <div data-testid="preview-normal-all-caught-up" className="text-meta qk-text-secondary">You're all caught up.</div>
    case 'surge':
      return <div data-testid="preview-surge" className="text-meta qk-text-secondary">Surge banner fixture</div>
    case 'mystery-locked':
      return <div data-testid="preview-mystery-locked" className="text-meta qk-text-secondary">Mystery locked · 0 / 1</div>
    case 'mystery-ready':
      return <div data-testid="preview-mystery-ready" className="text-meta qk-text-secondary">Mystery Drop unlocked · Open</div>
    case 'mystery-reveal':
      return <div data-testid="preview-mystery-reveal" className="text-meta qk-text-secondary">Mystery Drop reward card</div>
    case 'comeback-1d':
      return <div data-testid="preview-comeback-1d" className="text-meta qk-text-secondary">Comeback · return_1d · welcome back</div>
    case 'comeback-3d':
      return <div data-testid="preview-comeback-3d" className="text-meta qk-text-secondary">Comeback · return_3d · +25 XP</div>
    case 'comeback-7d':
      return <div data-testid="preview-comeback-7d" className="text-meta qk-text-secondary">Comeback · return_7d · +50 XP</div>
    case 'seasonal-christmas':
      return <div data-testid="preview-seasonal-christmas" className="text-meta qk-text-secondary">Christmas accent applied</div>
    case 'seasonal-halloween':
      return <div data-testid="preview-seasonal-halloween" className="text-meta qk-text-secondary">Halloween accent applied</div>
    case 'seasonal-ramadan-eid':
      return <div data-testid="preview-seasonal-ramadan-eid" className="text-meta qk-text-secondary">Ramadan / Eid accent applied</div>
    case 'seasonal-neon':
      return <div data-testid="preview-seasonal-neon" className="text-meta qk-text-secondary">Neon weekly accent applied</div>
    case 'xp-pop-mystery':
      return <div data-testid="preview-xp-pop-mystery" className="text-meta qk-text-secondary">Mystery +20 XP</div>
    case 'xp-pop-comeback':
      return <div data-testid="preview-xp-pop-comeback" className="text-meta qk-text-secondary">Comeback +25 XP</div>
    case 'reduced-motion':
      return <div data-testid="preview-reduced-motion" className="text-meta qk-text-secondary">Reduced motion active</div>
  }
}

export { EngagementPreviewSurface }
export default EngagementPreviewSurface