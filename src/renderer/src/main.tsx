import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { SettingsWindow } from '@renderer/components/settings/SettingsWindow'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
// Fonts.
// UI chrome uses the platform system font.
// JetBrains Mono is the data/code font (editor, results, ObjectId, etc.);
// bundled offline via @fontsource because the renderer CSP forbids remote
// font CDNs. OFL-1.1, free for commercial bundling.
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { setLanguage } from '@renderer/i18n'
import { useAppStore } from '@renderer/store/useAppStore'
import { webApi } from '@renderer/webApi'
import './styles/index.css'

if (__WEB__) window.api = webApi

// Dev-only escape hatch: expose the store so the app can be driven from the
// devtools console / CDP (manual testing, bug repros). Stripped in production.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}

// Desktop macOS uses a frameless window (titleBarStyle: hiddenInset); this flag
// drives the traffic-light clearance + window-drag CSS. Web keeps the AMDM
// brand visible because it has no native traffic lights to avoid.
if (!__WEB__ && navigator.platform.toLowerCase().includes('mac')) {
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

function WebRoot(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(window.location.hash === '#settings')
  const appRoot = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const syncRoute = (): void => {
      const open = window.location.hash === '#settings'
      setSettingsOpen((current) => {
        if (open && !current) previousFocus.current = document.activeElement as HTMLElement | null
        if (!open && current) requestAnimationFrame(() => previousFocus.current?.focus())
        return open
      })
    }
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)
    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  useEffect(() => {
    if (appRoot.current) appRoot.current.inert = settingsOpen
  }, [settingsOpen])

  const closeSettings = (): void => {
    if (window.history.state?.amdmRoute === 'settings') {
      window.history.back()
      return
    }
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    setSettingsOpen(false)
  }

  return (
    <>
      <div ref={appRoot} className="h-full" aria-hidden={settingsOpen || undefined}>
        <App />
      </div>
      {settingsOpen && createPortal(<SettingsWindow onClose={closeSettings} />, document.body)}
    </>
  )
}

const Root = __WEB__ ? WebRoot : window.location.hash === '#settings' ? SettingsWindow : App

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)
