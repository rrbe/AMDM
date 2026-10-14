import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

export interface ShellStatement {
  from: number
  to: number
  code: string
  firstLineFrom: number
}

/** Locate the complete top-level JavaScript statement at a document position. */
export function shellStatementAt(state: EditorState, pos = state.selection.main.head): ShellStatement | undefined {
  if (state.doc.length === 0) return undefined

  const safePos = Math.max(0, Math.min(pos, state.doc.length))
  const cursorLine = state.doc.lineAt(safePos)
  if (!cursorLine.text.trim()) return undefined

  const children = topLevelChildren(syntaxTree(state).topNode)
  const childIndex = children.findIndex(
    (node) => safePos >= node.from && safePos <= node.to && state.doc.lineAt(node.from).number === cursorLine.number
  )
  const sameLineIndex = children.findIndex(
    (node) =>
      state.doc.lineAt(node.from).number <= cursorLine.number && state.doc.lineAt(node.to).number >= cursorLine.number
  )
  const index = childIndex >= 0 ? childIndex : sameLineIndex
  if (index < 0) return undefined

  const statementIndex = executableIndexFor(children, index, state)
  if (statementIndex < 0) return undefined

  const statement = children[statementIndex]
  if (containsSyntaxError(statement)) return undefined

  let from = statement.from
  let boundary = statement.from
  for (let i = statementIndex - 1; i >= 0 && isComment(children[i]); i -= 1) {
    const comment = children[i]
    if (hasBlankLine(state.sliceDoc(comment.to, boundary))) break

    const previous = children[i - 1]
    if (
      previous &&
      !isComment(previous) &&
      state.doc.lineAt(previous.to).number === state.doc.lineAt(comment.from).number
    ) {
      break
    }
    from = comment.from
    boundary = comment.from
  }

  return {
    from,
    to: statement.to,
    code: state.sliceDoc(from, statement.to).trim(),
    firstLineFrom: state.doc.lineAt(from).from
  }
}

function topLevelChildren(root: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let child = root.firstChild; child; child = child.nextSibling) children.push(child)
  return children
}

function executableIndexFor(children: SyntaxNode[], index: number, state: EditorState): number {
  if (!isComment(children[index])) return children[index].type.isError ? -1 : index

  const previous = children[index - 1]
  if (
    previous &&
    !isComment(previous) &&
    state.doc.lineAt(previous.to).number === state.doc.lineAt(children[index].from).number
  ) {
    return previous.type.isError ? -1 : index - 1
  }

  let boundary = children[index].to
  for (let i = index + 1; i < children.length; i += 1) {
    const child = children[i]
    if (hasBlankLine(state.sliceDoc(boundary, child.from))) return -1
    if (!isComment(child)) return child.type.isError ? -1 : i
    boundary = child.to
  }
  return -1
}

function isComment(node: SyntaxNode): boolean {
  return node.name === 'LineComment' || node.name === 'BlockComment'
}

function hasBlankLine(text: string): boolean {
  return /\r?\n[\t ]*\r?\n/.test(text)
}

function containsSyntaxError(node: SyntaxNode): boolean {
  const pending = [node]
  while (pending.length) {
    const current = pending.pop()!
    if (current.type.isError) return true
    for (let child = current.firstChild; child; child = child.nextSibling) pending.push(child)
  }
  return false
}
