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
import { setLanguage } from '@renderer/i18n'
import './styles.css'

// macOS uses a frameless window (titleBarStyle: hiddenInset); this flag drives
// the traffic-light clearance + window-drag CSS in styles.css.
if (navigator.platform.toLowerCase().includes('mac')) {
  document.body.classList.add('is-mac')
}

// Paint the resolved theme before React mounts so there's no flash. The default
// preference is 'system', so resolve it from the OS here; App.tsx re-syncs to
// the persisted preference (and keeps following the OS) once settings load.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')

// Resolve the UI language from the OS locale for first paint (default pref is
// 'system'); App.tsx re-syncs to the persisted preference once settings load.
setLanguage('system')

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
