/**
 * Message contract between the TS-service worker and its main-thread client.
 * Messages are processed in order, so `init` → `decls` → `complete` arriving
 * back-to-back are applied in sequence without explicit acks.
 */

export interface TsCompletionEntry {
  name: string
  /** TS `ScriptElementKind` (e.g. 'method', 'property', 'keyword'). */
  kind: string
  /** TS sort key ('0','1',… lower = higher priority). */
  sortText: string
}

export interface TsDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
  collectionName?: string
}

export interface TsDiagnosticContext {
  database: string
  /** null means the catalog has not loaded; an empty array is a known empty database. */
  collections: string[] | null
}

export type TsWorkerRequest =
  | { type: 'init' }
  | { type: 'decls'; text: string }
  | { type: 'complete'; seq: number; code: string; pos: number }
  | { type: 'diagnose'; seq: number; code: string; context: TsDiagnosticContext }

export type TsWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; seq: number; entries: TsCompletionEntry[]; replacementSpan?: { from: number } }
  | { type: 'diagnostics'; seq: number; diagnostics: TsDiagnostic[] }
