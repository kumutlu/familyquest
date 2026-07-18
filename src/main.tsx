import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FAMILYQUEST_BUILD } from './buildInfo'
import './index.css'
import App from './App.tsx'
import { installServiceWorkerUpdateReload } from './serviceWorkerUpdate'

installServiceWorkerUpdateReload()

// PART 1 — Runtime build identifier. Proves which bundle is actually running
// in the browser so stale-deployment regressions can be diagnosed from the
// console / device logs.
console.info('[FamilyQuest Build]', {
  commit: FAMILYQUEST_BUILD.sha,
  builtAt: FAMILYQUEST_BUILD.builtAt,
  createTaskAtomic: true,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
