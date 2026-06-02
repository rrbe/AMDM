import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
// Bundled fonts (offline-safe; the renderer CSP forbids remote font CDNs):
// Space Grotesk for UI, IBM Plex Mono for code/data — the "Pine" design system.
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles.css'

// macOS uses a frameless window (titleBarStyle: hiddenInset); this flag drives
// the traffic-light clearance + window-drag CSS in styles.css.
if (navigator.platform.toLowerCase().includes('mac')) {
  document.body.classList.add('is-mac')
}

// Light-first: paint the default theme before React mounts so there's no flash.
// App.tsx re-syncs this to the persisted preference once settings load.
document.documentElement.setAttribute('data-theme', 'light')

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root not found')
}

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
