import { javascriptLanguage } from '@codemirror/lang-javascript'
import type { ShellRuntime } from '@shared/types'

type SyntaxNode = ReturnType<typeof javascriptLanguage.parser.parse>['topNode']

export interface ShellRuntimeSuggestion {
  runtime: ShellRuntime
  construct: string
}

function textOf(code: string, node: SyntaxNode): string {
  return code.slice(node.from, node.to)
}

function sameNode(left: SyntaxNode | null, right: SyntaxNode): boolean {
  return !!left && left.from === right.from && left.to === right.to && left.name === right.name
}

function propertyName(code: string, member: SyntaxNode): string | null {
  const property = member.lastChild
  return property?.name === 'PropertyName' ? textOf(code, property) : null
}

function isDb(code: string, node: SyntaxNode): boolean {
  return node.name === 'VariableName' && textOf(code, node) === 'db'
}

function dbMethodCall(code: string, node: SyntaxNode, method: string): boolean {
  if (node.name !== 'CallExpression') return false
  const member = node.firstChild
  if (member?.name !== 'MemberExpression' || propertyName(code, member) !== method) return false
  const owner = member.firstChild
  return !!owner && isDb(code, owner)
}

function directDbCollection(code: string, node: SyntaxNode): boolean {
  if (node.name !== 'MemberExpression') return false
  const owner = node.firstChild
  const property = node.lastChild
  return (
    !!owner &&
    isDb(code, owner) &&
    !!property &&
    (property.name === 'PropertyName' || property.name === 'String')
  )
}

function collectionExpression(code: string, node: SyntaxNode): boolean {
  return (
    directDbCollection(code, node) ||
    dbMethodCall(code, node, 'getCollection') ||
    dbMethodCall(code, node, 'collection')
  )
}

function collectionMethodCall(code: string, node: SyntaxNode, method: string): boolean {
  if (node.name !== 'CallExpression') return false
  const member = node.firstChild
  if (member?.name !== 'MemberExpression' || propertyName(code, member) !== method) return false
  const owner = member.firstChild
  return !!owner && collectionExpression(code, owner)
}

/** Detect only constructs whose runtime ownership is unambiguous. */
export function suggestShellRuntime(code: string, current: ShellRuntime): ShellRuntimeSuggestion | null {
  let suggestion: ShellRuntimeSuggestion | null = null
  javascriptLanguage.parser.parse(code).iterate({
    enter(ref) {
      if (suggestion || ref.name !== 'PropertyName') return
      const member = ref.node.parent
      const call = member?.parent
      const owner = member?.firstChild
      if (
        member?.name !== 'MemberExpression' ||
        call?.name !== 'CallExpression' ||
        !sameNode(call.firstChild, member) ||
        !owner
      )
        return

      const property = textOf(code, ref.node)
      if (current === 'legacy' && property === 'getMongo' && isDb(code, owner)) {
        suggestion = { runtime: 'mongosh', construct: 'db.getMongo()' }
        return
      }
      if (current !== 'mongosh') return

      if (isDb(code, owner) && (property === 'collection' || property === 'listCollections')) {
        suggestion = { runtime: 'legacy', construct: `db.${property}()` }
      } else if (property === 'indexes' && collectionExpression(code, owner)) {
        suggestion = { runtime: 'legacy', construct: 'collection.indexes()' }
      } else if (property === 'project' && collectionMethodCall(code, owner, 'find')) {
        suggestion = { runtime: 'legacy', construct: 'cursor.project()' }
      }
    }
  })
  return suggestion
}
