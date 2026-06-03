import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
// Fonts — matched to MongoDB Compass / LeafyGreen.
// UI uses LeafyGreen's system stack (Euclid Circular A if installed, else
// Helvetica Neue) so no UI webfont is bundled — proprietary, can't ship it.
// Source Code Pro is Compass's data/code font; bundled offline via @fontsource
// because the renderer CSP forbids remote font CDNs.
import '@fontsource/source-code-pro/400.css'
import '@fontsource/source-code-pro/500.css'
import '@fontsource/source-code-pro/600.css'
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
