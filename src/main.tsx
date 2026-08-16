import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { FAMILYQUEST_BUILD } from './buildInfo'
import './index.css'
import App from './App.tsx'
import { installServiceWorkerControllerListener } from './serviceWorkerUpdate'
import { installChunkLoadErrorMonitor } from './chunkLoadErrorMonitor'
import i18n, { bootstrapI18n } from './i18n'
import { markStartupStage, resetStartupMetrics } from './startupDiagnostics'
import { useAppearanceStore } from './store/appearanceStore'

resetStartupMetrics()
markStartupStage('APP_SCRIPT_READY')

// Observe (but never auto-reload on) service-worker controller changes. This
// records a diagnostic if a takeover happens mid-bootstrap instead of masking
// the failure with a reload.
installServiceWorkerControllerListener()

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
console.info('[FamilyQuest Build]', {
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
