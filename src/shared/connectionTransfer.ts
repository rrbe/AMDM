import type { AppSettings, ConnectionConfig } from './types'

export type ConnectionTransferFormat = 'amdm' | 'urls' | 'compass' | 'studio3t' | 'nosqlbooster' | 'robo3t'

export interface ConnectionExportRequest {
  ids: string[]
  format: ConnectionTransferFormat
  includeSecrets: boolean
  passphrase?: string
  destination: 'file' | 'clipboard'
}

export interface ConnectionTransferResult {
  count?: number
  cancelled?: boolean
  error?: string
}

export interface ConnectionImportRow {
  index: number
  name: string
  config: ConnectionConfig | null
  warnings: string[]
  error?: string
}

export interface ConnectionImportPreview {
  token: string
  fileName: string
  rows: ConnectionImportRow[]
  needsPassword?: boolean
  error?: string
}

export interface ConnectionImportRequest {
  token: string
  entries: { index: number; replaceId?: string }[]
  acknowledgeWarnings: boolean
}

export interface ConnectionImportResult extends ConnectionTransferResult {
  connections?: ConnectionConfig[]
  settings?: AppSettings
  replacedIds?: string[]
}

/** Desktop only. Decrypted credentials and imported source text stay in main. */
export interface ConnectionTransferApi {
  export(request: ConnectionExportRequest): Promise<ConnectionTransferResult>
  preview(request: { token?: string; passphrase?: string }): Promise<ConnectionImportPreview | null>
  apply(request: ConnectionImportRequest): Promise<ConnectionImportResult>
  release(token: string): Promise<void>
}
