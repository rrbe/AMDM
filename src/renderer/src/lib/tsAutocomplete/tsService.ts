import * as ts from 'typescript'
import { files as officialFiles, modules, roots } from 'virtual:mongosh-types'
import type { TsCompletionEntry } from './protocol'

const MAIN = '/main.ts'
const files: Record<string, string> = {
  ...officialFiles,
  '/decls.d.ts': '',
  [MAIN]: ''
}
const versions: Record<string, number> = {}

export function setFile(name: string, content: string): void {
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
  // Node declarations are available to imported types, not injected as Shell globals.
  getScriptFileNames: () => [MAIN, '/decls.d.ts', ...roots],
  getScriptVersion: (f) => String(versions[f] ?? 0),
  resolveModuleNames: (names, containingFile) =>
    names.map((name) => {
      const resolvedFileName = modules[containingFile + ':' + name]
      return resolvedFileName ? { resolvedFileName, extension: ts.Extension.Dts } : undefined
    }),
  getScriptSnapshot: (f) => (files[f] != null ? ts.ScriptSnapshot.fromString(files[f]) : undefined),
  getCurrentDirectory: () => '/',
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: () => '/lib.d.ts', // unused under noLib
  fileExists: (f) => files[f] != null,
  readFile: (f) => files[f]
}

const service = ts.createLanguageService(host, ts.createDocumentRegistry())

export function complete(
  code: string,
  pos: number
): { entries: TsCompletionEntry[]; replacementSpan?: { from: number } } {
  setFile(MAIN, code)
  const info = service.getCompletionsAtPosition(MAIN, pos, {
    includeCompletionsWithInsertText: true
  })
  if (!info) return { entries: [] }
  const entries: TsCompletionEntry[] = info.entries
    .filter((e) => !e.name.startsWith('_'))
    .map((e) => ({
      name: e.name,
      kind: e.kind,
      sortText: e.sortText
    }))
  const span = info.optionalReplacementSpan
  return { entries, replacementSpan: span ? { from: span.start } : undefined }
}
