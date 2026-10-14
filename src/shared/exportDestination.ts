import type { ExportFormat } from './types'

/** File extension controlled by the selected export format. */
export function exportFileExtension(format: ExportFormat, gzip = false): string {
  return format === 'bson' && gzip ? 'bson.gz' : format
}

/** Keep user-entered file names portable and confined to the selected directory. */
export function sanitizeExportBaseName(name: string): string {
  return (name.trim() || 'export').replace(/[\\/:*?"<>|\0]/g, '-')
}
