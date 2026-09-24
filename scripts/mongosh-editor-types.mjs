import { createRequire } from 'node:module'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let cached

/** Read declarations at build time; no Shell or Node runtime reaches the editor. */
export function mongoshEditorTypes() {
  if (cached) return cached
  const { api } = require('@mongosh/shell-api/api')
  const root = process.cwd()
  const apiPath = resolve(root, 'node_modules/@mongosh/shell-api/lib/editor-api.d.ts')
  const entry = resolve(root, 'node_modules/amdm-editor.d.ts')
  const globals = `
import type { DatabaseWithSchema, CollectionWithSchema, ReplicaSet, Shard } from './@mongosh/shell-api/lib/editor-api';
import type { Db } from 'mongodb';
declare global {
  interface AmdmCollections {}
  type Collection = CollectionWithSchema;
  const db: DatabaseWithSchema & AmdmCollections;
  const rs: ReplicaSet;
  const sh: Shard;
  const driverDb: Db;
  const console: Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
}
`
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
    skipLibCheck: true
  }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  host.readFile = (path) => (path === apiPath ? api : path === entry ? globals : read(path))
  const exists = host.fileExists.bind(host)
  host.fileExists = (path) => path === apiPath || path === entry || exists(path)
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path)
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true)
  }
  const program = ts.createProgram([entry, apiPath], options, host)
  const pathKey = (path) => '/' + relative(root, path).replaceAll('\\', '/')
  const files = {}
  const modules = {}
  const roots = [pathKey(entry)]
  const printer = ts.createPrinter({ removeComments: true })
  for (const source of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(source)) roots.push(pathKey(source.fileName))
    // Node types are needed by BSON/Driver signatures, but their globals do not
    // exist in AMDM's isolated Shell context.
    const typesOnly = (statements) =>
      statements.filter(
        (statement) => !ts.isVariableStatement(statement) && !ts.isFunctionDeclaration(statement)
      )
    const transformed = source.fileName.includes('/@types/node/')
      ? ts.transform(source, [
          (context) => (root) => {
            const visit = (node) => {
              if (
                ts.isModuleDeclaration(node) &&
                node.flags & ts.NodeFlags.GlobalAugmentation &&
                node.body &&
                ts.isModuleBlock(node.body)
              ) {
                return ts.factory.updateModuleDeclaration(
                  node,
                  node.modifiers,
                  node.name,
                  ts.factory.updateModuleBlock(node.body, typesOnly(node.body.statements))
                )
              }
              return ts.visitEachChild(node, visit, context)
            }
            const result = ts.visitNode(root, visit)
            return ts.isExternalModule(root)
              ? result
              : ts.factory.updateSourceFile(result, typesOnly(result.statements))
          }
        ])
      : undefined
    files[pathKey(source.fileName)] = printer.printFile(transformed?.transformed[0] ?? source)
    transformed?.dispose()
    for (const { fileName: specifier } of ts.preProcessFile(source.text).importedFiles) {
      const result = ts.resolveModuleName(specifier, source.fileName, options, host).resolvedModule
      if (result) modules[pathKey(source.fileName) + ':' + specifier] = pathKey(result.resolvedFileName)
    }
  }
  const source = ts.createSourceFile(apiPath, api, ts.ScriptTarget.Latest, true)
  const methods = {}
  const bases = {}
  for (const node of source.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) continue
    bases[node.name.text] = node.heritageClauses
      ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression.getText(source)
    methods[node.name.text] = node.members
      .filter(
        (member) =>
          (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) &&
          member.name &&
          !ts.isComputedPropertyName(member.name) &&
          !member.modifiers?.some(
            (m) =>
              m.kind === ts.SyntaxKind.PrivateKeyword ||
              m.kind === ts.SyntaxKind.ProtectedKeyword ||
              m.kind === ts.SyntaxKind.StaticKeyword
          )
      )
      .map((member) => member.name.getText(source).replace(/^['"]|['"]$/g, ''))
      .filter((name) => !name.startsWith('_'))
  }
  const inherited = (name) => [
    ...new Set([...(bases[name] && methods[bases[name]] ? inherited(bases[name]) : []), ...methods[name]])
  ]
  for (const name of Object.keys(methods)) methods[name] = inherited(name)
  cached = { files, modules, methods, roots }
  return cached
}

export function mongoshEditorPlugin() {
  return {
    name: 'mongosh-editor-types',
    resolveId(id) {
      if (id === 'virtual:mongosh-types' || id === 'virtual:mongosh-methods') return '\0' + id
    },
    load(id) {
      if (id === '\0virtual:mongosh-types') {
        const { files, modules, roots } = mongoshEditorTypes()
        return `export const files = ${JSON.stringify(files)}; export const modules = ${JSON.stringify(modules)}; export const roots = ${JSON.stringify(roots)};`
      }
      if (id === '\0virtual:mongosh-methods')
        return `export default ${JSON.stringify(mongoshEditorTypes().methods)};`
    }
  }
}
