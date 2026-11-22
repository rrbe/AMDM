import type { parse } from '@babel/parser'
import type { CallExpression, MemberExpression, ObjectProperty } from '@babel/types'
import type { ShellResult } from '../../shared/types'

type Argument = CallExpression['arguments'][number]
const cursorModifiers = new Set(['sort', 'limit', 'skip', 'hint', 'collation', 'batchSize', 'maxTimeMS'])
const findOptions = new Set(['sort', 'limit', 'skip', 'hint', 'collation', 'batchSize', 'maxTimeMS', 'comment'])

function propertyName(property: MemberExpression | ObjectProperty): string | undefined {
  const key = property.type === 'MemberExpression' ? property.property : property.key
  if (key.type === 'StringLiteral') return key.value
  if (!property.computed && key.type === 'Identifier') return key.name
}

function simpleProjection(arg?: Argument | ObjectProperty['value']): boolean {
  if (!arg || arg.type === 'NullLiteral') return true
  return arg.type === 'ObjectExpression' && arg.properties.every((prop) => {
    if (prop.type !== 'ObjectProperty') return false
    const name = propertyName(prop)
    // Projecting part of a compound _id or selecting array elements changes write targets.
    if (!name || name.includes('.') || name.startsWith('$') || name === '__proto__') return false
    const flag = prop.value
    if (flag.type === 'BooleanLiteral') return name !== '_id' || flag.value
    return flag.type === 'NumericLiteral' && (flag.value === 1 || (flag.value === 0 && name !== '_id'))
  })
}

function simpleOptions(arg?: Argument): boolean {
  if (!arg) return true
  return arg.type === 'ObjectExpression' && arg.properties.every((prop) => {
    if (prop.type !== 'ObjectProperty') return false
    const name = propertyName(prop)
    return name === 'projection' ? simpleProjection(prop.value) : findOptions.has(name ?? '')
  })
}

function readCollection(node: MemberExpression['object'], database: string) {
  let collection: string | undefined
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const method = propertyName(node.callee)
    if (node.arguments.length !== 1 || node.arguments[0].type !== 'StringLiteral') return
    collection = node.arguments[0].value
    node = node.callee.object
    if (method === 'collection' && node.type === 'Identifier' && node.name === 'driverDb') {
      return { database, collection, driver: true }
    }
    if (method !== 'getCollection') return
  } else if (node.type === 'MemberExpression') {
    collection = propertyName(node)
    node = node.object
  }
  if (!collection) return
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
      propertyName(node.callee) === 'getSiblingDB' && node.arguments.length === 1 && node.arguments[0].type === 'StringLiteral') {
    database = node.arguments[0].value
    node = node.callee.object
  }
  if (node.type === 'Identifier' && node.name === 'db') return { database, collection, driver: false }
}

/** Only direct collection reads with intact document ids and field paths support writes. */
export function documentSource(program: ReturnType<typeof parse>['program'], database: string): ShellResult['documentSource'] {
  const [statement] = program.body
  if (program.body.length !== 1 || statement.type !== 'ExpressionStatement') return
  let node: MemberExpression['object'] = statement.expression
  if (node.type === 'AwaitExpression') node = node.argument
  let outermost = true
  while (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const method = propertyName(node.callee)
    const args = node.arguments
    if (args.some((arg) => arg.type === 'SpreadElement')) return
    if (method === 'find' || (method === 'findOne' && outermost)) {
      const source = readCollection(node.callee.object, database)
      if (!source) return
      if (source.driver) {
        if (args.length > 2 || !simpleOptions(args[1])) return
      } else if (args.length > 3 || !simpleProjection(args[1]) || !simpleOptions(args[2])) return
      return { database: source.database, collection: source.collection }
    }
    if (method === 'toArray' || method === 'next' || method === 'tryNext') {
      if (!outermost || args.length) return
    } else if (method === 'project') {
      if (args.length !== 1 || !simpleProjection(args[0])) return
    } else if (!cursorModifiers.has(method ?? '')) return
    node = node.callee.object
    outermost = false
  }
}
