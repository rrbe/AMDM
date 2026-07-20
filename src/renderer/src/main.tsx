import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
// Fonts.
// UI chrome keeps a system sans stack (Euclid Circular A if installed, else
// Helvetica Neue) — proprietary, no UI webfont bundled.
// JetBrains Mono is the data/code font (editor, results, ObjectId, etc.);
// bundled offline via @fontsource because the renderer CSP forbids remote
// font CDNs. OFL-1.1, free for commercial bundling.
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { setLanguage } from '@renderer/i18n'
import { useAppStore } from '@renderer/store/useAppStore'
import './styles/index.css'

// Dev-only escape hatch: expose the store so the app can be driven from the
// devtools console / CDP (manual testing, bug repros). Stripped in production.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}

// macOS uses a frameless window (titleBarStyle: hiddenInset); this flag drives
// the traffic-light clearance + window-drag CSS in styles/app-shell.css.
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
