import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './buildInfo'
import './index.css'
import App from './App.tsx'
import { installServiceWorkerUpdateReload } from './serviceWorkerUpdate'

installServiceWorkerUpdateReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
