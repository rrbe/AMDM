/**
 * Renderer Web Worker hosting a TypeScript language service over an in-memory
 * 3-file virtual FS (`/base.d.ts` = static mongo API, `/decls.d.ts` = live
 * collection augmentations, `/main.ts` = the user's shell code). It answers
 * `complete` requests with `getCompletionsAtPosition` so chained mongo
 * expressions get real type-aware completion. Runs with `noLib` (globals are in
 * the base d.ts) to keep the worker from needing the ~30 lib.es*.d.ts files.
 *
 * Bundled lazily as its own chunk by Vite (it imports the whole `typescript`
 * compiler). The main thread treats a missing/failed worker as "fall back to
 * the regex completion source", so this never becomes a hard dependency.
 */
import * as ts from 'typescript'
import type {
  TsWorkerRequest,
  TsWorkerResponse,
  TsCompletionEntry
} from '@renderer/lib/tsAutocomplete/protocol'

// `self` is the worker global; type it minimally to avoid pulling the webworker
// lib (the renderer tsconfig targets DOM, where `self` is a Window).
const scope = self as unknown as {
  postMessage(message: TsWorkerResponse): void
  onmessage: ((e: { data: TsWorkerRequest }) => void) | null
}

const MAIN = '/main.ts'
const files: Record<string, string> = { '/base.d.ts': '', '/decls.d.ts': '', [MAIN]: '' }
const versions: Record<string, number> = { '/base.d.ts': 0, '/decls.d.ts': 0, [MAIN]: 0 }

function setFile(name: string, content: string): void {
  if (files[name] === content) return
  files[name] = content
  versions[name] = (versions[name] ?? 0) + 1
}

const compilerOptions: ts.CompilerOptions = {
  noLib: true,
  allowJs: true,
  checkJs: false,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  allowNonTsExtensions: true
}

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => Object.keys(files),
  getScriptVersion: (f) => String(versions[f] ?? 0),
  getScriptSnapshot: (f) =>
    files[f] != null ? ts.ScriptSnapshot.fromString(files[f]) : undefined,
  getCurrentDirectory: () => '/',
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: () => '/lib.d.ts', // unused under noLib
  fileExists: (f) => files[f] != null,
  readFile: (f) => files[f]
}

const service = ts.createLanguageService(host, ts.createDocumentRegistry())

function complete(code: string, pos: number): { entries: TsCompletionEntry[]; replacementSpan?: { from: number } } {
  setFile(MAIN, code)
  const info = service.getCompletionsAtPosition(MAIN, pos, {
    includeCompletionsWithInsertText: true
  })
  if (!info) return { entries: [] }
  const entries: TsCompletionEntry[] = info.entries.map((e) => ({
    name: e.name,
    kind: e.kind,
    sortText: e.sortText
  }))
  const span = info.optionalReplacementSpan
  return { entries, replacementSpan: span ? { from: span.start } : undefined }
}

scope.onmessage = (e): void => {
  const msg = e.data
  if (msg.type === 'init') {
    setFile('/base.d.ts', msg.baseDts)
    scope.postMessage({ type: 'ready' })
    return
  }
  if (msg.type === 'decls') {
    setFile('/decls.d.ts', msg.text)
    return
  }
  if (msg.type === 'complete') {
    let result: { entries: TsCompletionEntry[]; replacementSpan?: { from: number } } = { entries: [] }
    try {
      result = complete(msg.code, msg.pos)
    } catch {
      result = { entries: [] }
    }
    scope.postMessage({ type: 'result', seq: msg.seq, ...result })
  }
}
