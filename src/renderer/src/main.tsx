import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
import './styles.css'

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
