import { CompletionContext } from '@codemirror/autocomplete'
import { localCompletionSource } from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { IterMode, NodeWeakMap, type SyntaxNode } from '@lezer/common'

const scopes = new Set([
  'Script',
  'Block',
  'FunctionExpression',
  'FunctionDeclaration',
  'ArrowFunction',
  'MethodDeclaration',
  'ForStatement',
  'CatchClause'
])
const shorthandCache = new NodeWeakMap<Set<string>>()
const globalCache = new WeakMap<
  EditorState,
  {
    tree: ReturnType<typeof syntaxTree>
    values: Map<string, boolean>
  }
>()

/** CodeMirror's local completer omits shorthand destructuring bindings. */
function shorthandBindings(state: EditorState, scope: SyntaxNode): Set<string> {
  const cached = shorthandCache.get(scope)
  if (cached) return cached
  const names = new Set<string>()
  let first = true
  scope.cursor(IterMode.IncludeAnonymous).iterate((node) => {
    if (first) {
      first = false
      return
    }
    if (scopes.has(node.name)) return false
    if (node.name === 'PatternProperty') {
      const property = node.node.firstChild
      if (property?.name === 'PropertyName' && property.nextSibling?.name !== ':') {
        names.add(state.sliceDoc(property.from, property.to))
      }
    } else if (!node.name && node.to - node.from > 8192) {
      for (const name of shorthandBindings(state, node.node)) names.add(name)
      return false
    }
  })
  shorthandCache.set(scope, names)
  return names
}

/** Use the incremental parser, including multiline comments and templates. */
export function isShellText(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (/^(String|TemplateString|RegExp|LineComment|BlockComment)$/.test(node.name)) return true
    if (node.name === 'Interpolation') return false
  }
  return false
}

/** CodeMirror caches declarations on its incremental scope nodes. */
export function isShellGlobal(state: EditorState, from: number, to: number): boolean {
  const name = state.sliceDoc(from, to)
  const tree = syntaxTree(state)
  let scope = tree.resolveInner(to, -1)
  while (scope.parent && !scopes.has(scope.name)) scope = scope.parent
  let cache = globalCache.get(state)
  if (!cache || cache.tree !== tree) {
    cache = { tree, values: new Map() }
    globalCache.set(state, cache)
  }
  const key = `${scope.from}:${scope.to}:${name}`
  const cached = cache.values.get(key)
  if (cached !== undefined) return cached
  const result = isUnshadowed(state, to, name)
  cache.values.set(key, result)
  return result
}

function isUnshadowed(state: EditorState, to: number, name: string): boolean {
  const locals = localCompletionSource(new CompletionContext(state, to, true))
  if (locals?.options.some((option) => option.label === name)) return false
  for (let node = syntaxTree(state).resolveInner(to, -1); node; node = node.parent!) {
    if (scopes.has(node.name) && shorthandBindings(state, node).has(name)) return false
  }
  return true
}
