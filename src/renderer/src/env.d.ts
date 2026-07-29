/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

declare global {
  const __BUILD_ID__: string

  interface Window {
    api: Api
  }
}

export {}
