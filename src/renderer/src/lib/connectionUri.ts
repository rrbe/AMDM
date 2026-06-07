/**
 * Renderer-facing re-export of the shared connection-string helpers, plus the
 * UI-only preset color swatches. The parse/build logic itself lives in
 * `@shared/connectionUri` so the main process can reuse it (export with the
 * decrypted password).
 */
export {
  parseMongoUri,
  buildMongoUri,
  type ParsedUri,
  type BuildUriInput
} from '@shared/connectionUri'

/** The preset color swatches offered for tagging a connection. */
export const PRESET_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899' // pink
] as const
