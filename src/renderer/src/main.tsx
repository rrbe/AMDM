import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
import './styles.css'

// macOS uses a frameless window (titleBarStyle: hiddenInset); this flag drives
// the traffic-light clearance + window-drag CSS in styles.css.
if (navigator.platform.toLowerCase().includes('mac')) {
  document.body.classList.add('is-mac')
}

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
