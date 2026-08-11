/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

declare global {
  const __BUILD_ID__: string
  const __WEB__: boolean

  interface Window {
    api: Api
  }
}

export {}
