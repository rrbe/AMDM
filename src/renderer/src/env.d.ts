/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

declare global {
  const __APP_VERSION__: string

  interface Window {
    api: Api
  }
}

export {}
