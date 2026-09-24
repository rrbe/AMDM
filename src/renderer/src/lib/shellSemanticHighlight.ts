import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { SHELL_GLOBALS } from '@renderer/lib/completionRegistry'
import { DATABASE_RESERVED } from './tsAutocomplete/mongoBaseDts'
import { isShellGlobal, isShellText } from './shellSyntax'

export type ShellSemanticKind =
  'db' | 'collection' | 'method' | 'operator' | 'constructor' | 'field' | 'command'

export interface ShellSemanticToken {
  from: number
  to: number
  kind: ShellSemanticKind
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

const CONSTRUCTORS = new Set(SHELL_GLOBALS)
const SHELL_OBJECTS = new Set(['db', 'driverDb', 'rs', 'sh', 'config', 'EJSON'])

function shellRoot(node: SyntaxNode, state: EditorState): boolean {
  let root = node
  while (root.name === 'MemberExpression' || root.name === 'CallExpression') {
    if (!root.firstChild) return false
    root = root.firstChild
  }
  return (
    root.name === 'VariableName' &&
    SHELL_OBJECTS.has(textOf(state, root)) &&
    isShellGlobal(state, root.from, root.to)
  )
}

function sameNode(a: SyntaxNode | null, b: SyntaxNode): boolean {
  return !!a && a.from === b.from && a.to === b.to && a.name === b.name
}

function textOf(state: EditorState, node: SyntaxNode): string {
  return state.sliceDoc(node.from, node.to)
}

function unquote(value: string): string {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value
}

function isCalledProperty(node: SyntaxNode): boolean {
  const member = node.parent
  if (member?.name !== 'MemberExpression' || !sameNode(member.lastChild, node)) return false
  const call = member.parent
  return call?.name === 'CallExpression' && sameNode(call.firstChild, member)
}

function isDbCollection(node: SyntaxNode, state: EditorState): boolean {
  const member = node.parent
  if (member?.name !== 'MemberExpression') return false
  const owner = member.firstChild
  return (
    owner?.name === 'VariableName' &&
    textOf(state, owner) === 'db' &&
    !DATABASE_RESERVED.has(unquote(textOf(state, node))) &&
    isShellGlobal(state, owner.from, owner.to)
  )
}

function classify(node: SyntaxNode, state: EditorState): ShellSemanticKind | null {
  const text = textOf(state, node)

  if (node.name === 'VariableName') {
    if (SHELL_OBJECTS.has(text) && isShellGlobal(state, node.from, node.to)) return 'db'
    if (CONSTRUCTORS.has(text) && isShellGlobal(state, node.from, node.to)) return 'constructor'
    return null
  }

  if (node.name === 'PropertyName') {
    if (isCalledProperty(node) && shellRoot(node.parent!, state)) return 'method'
    if (isDbCollection(node, state)) return 'collection'
    return null
  }

  let inQuery = false
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'CallExpression' && shellRoot(parent, state)) {
      inQuery = true
      break
    }
  }
  if (node.name === 'PropertyDefinition' && inQuery) return text.startsWith('$') ? 'operator' : 'field'

  if (node.name === 'String') {
    if (isDbCollection(node, state)) return 'collection'
    if (inQuery && node.parent?.name === 'Property' && sameNode(node.parent.firstChild, node)) {
      return unquote(text).startsWith('$') ? 'operator' : 'field'
    }
  }

  return null
}

/**
 * Classify visible shell tokens from CodeMirror's existing JavaScript tree.
 * Keeping this pure makes the MongoDB-specific layer independently testable;
 * the view plugin below only turns the returned ranges into decorations.
 */
export function shellSemanticTokens(
  state: EditorState,
  from = 0,
  to = state.doc.length
): ShellSemanticToken[] {
  const tokens: ShellSemanticToken[] = []
  // REPL commands are only recognized at the top level, on their own line.
  for (let pos = state.doc.lineAt(from).from; pos <= to;) {
    const line = state.doc.lineAt(pos)
    const match = /^(\s*)(use|show)\s+([^;]+?)\s*;?\s*$/.exec(line.text)
    if (match) {
      const start = line.from + match[1].length
      let nested = false
      for (let node = syntaxTree(state).resolveInner(start + 1); node; node = node.parent!) {
        if (/Block|Function|ObjectExpression/.test(node.name)) nested = true
      }
      const argument = match[3]
      if (
        !nested &&
        !isShellText(state, start + 1) &&
        (match[2] === 'use'
          ? /^[\w.$-]+$/.test(argument)
          : /^(dbs|databases|collections|tables|users|roles|profile|logs|log\s+\S+)$/.test(argument))
      ) {
        tokens.push({
          from: start,
          to: start + match[2].length,
          kind: 'command'
        })
      }
    }
    if (line.to >= state.doc.length) break
    pos = line.to + 1
  }
  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      const kind = classify(ref.node, state)
      if (kind) tokens.push({ from: ref.from, to: ref.to, kind })
    }
  })
  return tokens
}

const marks: Record<ShellSemanticKind, Decoration> = {
  db: Decoration.mark({ class: 'cm-shell-db' }),
  collection: Decoration.mark({ class: 'cm-shell-collection' }),
  method: Decoration.mark({ class: 'cm-shell-method' }),
  operator: Decoration.mark({ class: 'cm-shell-operator' }),
  constructor: Decoration.mark({ class: 'cm-shell-constructor' }),
  field: Decoration.mark({ class: 'cm-shell-field' }),
  command: Decoration.mark({ class: 'cm-shell-command' })
}

function decorationsFor(view: EditorView): DecorationSet {
  const ranges = view.visibleRanges.flatMap(({ from, to }) =>
    shellSemanticTokens(view.state, from, to).map((token) => marks[token.kind].range(token.from, token.to))
  )
  return Decoration.set(ranges, true)
}

export function shouldRefreshShellSemanticHighlight(
  update: Pick<ViewUpdate, 'docChanged' | 'viewportChanged' | 'startState' | 'state'>
): boolean {
  return (
    update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)
  )
}

/** MongoDB-aware syntax colors layered over the JavaScript highlighter. */
export const shellSemanticHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = decorationsFor(view)
    }

    update(update: ViewUpdate): void {
      if (shouldRefreshShellSemanticHighlight(update)) this.decorations = decorationsFor(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
