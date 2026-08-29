import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { FAMILYQUEST_BUILD } from './buildInfo'
import './index.css'
import App from './App.tsx'
import {
  installServiceWorkerControllerListener,
  installServiceWorkerUpdateHandler,
  LEGACY_SW_MIGRATION_ID,
} from './serviceWorkerUpdate'
import { installChunkLoadErrorMonitor } from './chunkLoadErrorMonitor'
import i18n, { bootstrapI18n } from './i18n'
import { markStartupStage, resetStartupMetrics } from './startupDiagnostics'
import { useAppearanceStore } from './store/appearanceStore'

resetStartupMetrics()
markStartupStage('APP_SCRIPT_READY')

// ONE RELEASE ONLY: observe migration takeover and keep a guarded fallback
// reload. The migration worker normally navigates legacy clients itself; the
// listener's session marker prevents a second reload during that race.
installServiceWorkerControllerListener(undefined, { migrationId: LEGACY_SW_MIGRATION_ID })

// Register the PWA service worker and wire a SAFE update path. The worker is
// Normally built with `registerType: 'prompt'` + waiting semantics. This rescue
// release temporarily enables immediate activation/claim for legacy clients;
// in subsequent normal releases, `installServiceWorkerUpdateHandler` detects
// the waiting worker and, once bootstrap has finished, tells it to
// `skipWaiting()` and reloads — guaranteeing the user eventually runs the
// current build SHA instead of a stale, SW-cached bundle (the Safari bug).
//
// `injectRegister` is set to `null` in vite.config.ts so registration is owned
// here rather than by the plugin's injected script; this avoids a double
// registration and lets us attach the update handler to the real registration.
function registerServiceWorkerAndInstallUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // No service worker in development: the dev server + HMR must not be
  // interfered with by a precaching SW (and the dev build is self-destroying).
  if (import.meta.env.MODE === 'development') return
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      installServiceWorkerUpdateHandler(registration)
    })
    .catch(() => {
      // Registration failure is non-fatal: the app still works online, only
      // offline/PWA is degraded. Never let it break bootstrap.
    })
}

registerServiceWorkerAndInstallUpdate()

// Classify chunk-load failures (e.g. a stale hashed asset after a deploy) as a
// distinct, non-sensitive diagnostic rather than a generic timeout.
installChunkLoadErrorMonitor()

// Apply the persisted appearance (Light/Dark/System) and start listening for OS
// changes. The inline bootstrap in index.html already set the root `dark` class
// before first paint to avoid a flash; this mirrors that into React state and
// keeps it live.
useAppearanceStore.getState().initAppearance()

// PART 1 — Runtime build identifier. Proves which bundle is actually running
// in the browser so stale-deployment regressions can be diagnosed from the
// console / device logs.
// Stable full-SHA marker consumed by the production Hosting deployment guard.
// Keep the marker format independent of minifier property ordering.
console.info(`[FamilyQuest Build SHA:${__FAMILYQUEST_BUILD_SHA__}]`, {
  commit: FAMILYQUEST_BUILD.sha,
  builtAt: FAMILYQUEST_BUILD.builtAt,
  createTaskAtomic: true,
})

// Common/startup strings for both supported languages are already bundled.
// Begin language selection without making React wait for any feature namespace.
void bootstrapI18n()

markStartupStage('REACT_MOUNT_START')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
)
