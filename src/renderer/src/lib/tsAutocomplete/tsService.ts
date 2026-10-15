import * as ts from 'typescript'
import { files as officialFiles, modules, roots } from 'virtual:mongosh-types'
import type { TsCompletionEntry, TsDiagnostic, TsDiagnosticContext } from './protocol'
import { DATABASE_RESERVED } from './mongoBaseDts'

const MAIN = '/main.js'
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
  checkJs: true,
  strict: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
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

// Shell scripts are JavaScript, so inferred assignment/nullability/argument-type
// checks would reject valid runtime code. Report unresolved names and members,
// and attempts to call non-functions, alongside all parser diagnostics.
const SEMANTIC_ERRORS = new Set([
  1104, 1105, 1107, 1108, // Invalid continue, break, or return.
  1155, 2451, 2588, // Uninitialized/redeclared constants and constant assignment.
  2304, 2339, 2349, 2551, 2552 // Unresolved names/members and non-callable values.
])
const MAX_DIAGNOSTICS = 100

/** Parse-only analysis in the existing worker; never evaluates query code. */
export function diagnose(code: string, context: TsDiagnosticContext): TsDiagnostic[] {
  const original = ts.createSourceFile(MAIN, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const commands: { from: number; to: number; database?: string }[] = []
  // Mongosh's top-level `show` / `use` commands are not JavaScript. Mask only
  // genuine command statements, retaining offsets and line breaks for markers.
  for (const statement of original.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isIdentifier(statement.expression)) continue
    if (!['use', 'show'].includes(statement.expression.text)) continue
    const start = statement.getStart(original)
    const lineStart = code.lastIndexOf('\n', start - 1) + 1
    const lineEnd = code.indexOf('\n', start)
    const end = lineEnd < 0 ? code.length : lineEnd
    const match = /^[\t ]*(use|show)[\t ]+([^;\r\n]+?)\s*;?\s*$/.exec(code.slice(lineStart, end))
    if (!match || code.slice(lineStart, start).trim()) continue
    const argument = match[2]
    if (
      match[1] === 'use'
        ? !/^[\w.$-]+$/.test(argument)
        : !/^(dbs|databases|collections|tables|users|roles|profile|logs|log\s+\S+)$/.test(argument)
    )
      continue
    commands.push({ from: lineStart, to: end, database: match[1] === 'use' ? argument : undefined })
  }
  let normalized = code
  for (const command of [...commands].reverse()) {
    normalized =
      normalized.slice(0, command.from) +
      ';' +
      ' '.repeat(command.to - command.from - 1) +
      normalized.slice(command.to)
  }
  setFile(MAIN, normalized)
  const diagnostics: TsDiagnostic[] = [
    ...service.getSyntacticDiagnostics(MAIN),
    ...service
      .getSemanticDiagnostics(MAIN)
      .filter((item) => SEMANTIC_ERRORS.has(item.code))
  ]
    .filter((item) => item.start !== undefined)
    .slice(0, MAX_DIAGNOSTICS)
    .map((item) => {
      // TS uses an empty span for missing closing punctuation at EOF. Mark the
      // adjacent character as well so the problem remains visible and hoverable.
      const from = Math.min(item.start!, Math.max(0, code.length - 1))
      return {
        from,
        to: Math.min(code.length, Math.max(from + 1, item.start! + (item.length ?? 0))),
        severity: 'error',
        message: ts.flattenDiagnosticMessageText(item.messageText, '\n')
      }
    })
  if (context.collections === null || diagnostics.length >= MAX_DIAGNOSTICS) return diagnostics

  const program = service.getProgram()!
  const source = program.getSourceFile(MAIN)!
  const checker = program.getTypeChecker()
  const names = new Set(context.collections)
  const isGlobal = (node: ts.Expression, name: string): boolean =>
    ts.isIdentifier(node) &&
    node.text === name &&
    !!checker
      .getSymbolAtLocation(node)
      ?.declarations?.every((decl) => decl.getSourceFile() !== source)
  const checkCollection = (node: ts.Node, name: string): void => {
    if (names.has(name)) return
    let database = context.database
    for (const command of commands) {
      if (command.from >= node.getStart(source)) break
      if (command.database !== undefined) database = command.database
    }
    if (database !== context.database) return
    diagnostics.push({
      from: node.getStart(source),
      to: node.end,
      severity: 'warning',
      message: `Collection '${name}' is not in the loaded catalog.`,
      collectionName: name
    })
  }
  const visit = (node: ts.Node): void => {
    if (diagnostics.length >= MAX_DIAGNOSTICS) return
    if (
      ts.isPropertyAccessExpression(node) &&
      isGlobal(node.expression, 'db') &&
      !DATABASE_RESERVED.has(node.name.text) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      checkCollection(node.name, node.name.text)
    } else if (
      ts.isElementAccessExpression(node) &&
      isGlobal(node.expression, 'db') &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      !DATABASE_RESERVED.has(node.argumentExpression.text)
    ) {
      checkCollection(node.argumentExpression, node.argumentExpression.text)
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const member = node.expression
      if (
        (isGlobal(member.expression, 'db') && member.name.text === 'getCollection') ||
        (isGlobal(member.expression, 'driverDb') && member.name.text === 'collection')
      ) {
        const name = node.arguments[0]
        if (name && ts.isStringLiteralLike(name)) checkCollection(name, name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return diagnostics.sort((a, b) => a.from - b.from)
}
