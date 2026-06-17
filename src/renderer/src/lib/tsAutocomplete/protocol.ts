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

export type TsWorkerRequest =
  | { type: 'init'; baseDts: string }
  | { type: 'decls'; text: string }
  | { type: 'complete'; seq: number; code: string; pos: number }

export type TsWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; seq: number; entries: TsCompletionEntry[]; replacementSpan?: { from: number } }
