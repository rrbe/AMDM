import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { CallExpression, Node, OptionalCallExpression, Program } from '@babel/types'

const activeSource = new AsyncLocalStorage<string>()
export const currentConsoleSource = (): string | undefined => activeSource.getStore()

/** Tag the callable, so arguments (including nested prints) evaluate in their own context. */
export function annotateConsoleCalls(code: string, program: Program, context: Record<string, unknown>): string {
  const helper = '__amdmPrint_' + randomUUID().replaceAll('-', '')
  const sources: string[] = []
  const edits: { start: number; end: number; text: string }[] = []
  const shellConsole = context.console as Record<string, unknown>
  const captured = new Set([context.print, context.printjson, ...Object.values(shellConsole)])

  function tag(call: CallExpression | OptionalCallExpression, method?: string): void {
    const fn = call.callee
    const summary = code.slice(call.start!, call.end!).split(/[\r\n\u2028\u2029]+/).map(line => line.trim()).filter(Boolean).join(' ')
    const index = sources.push(summary.length > 120 ? summary.slice(0, 119) + '…' : summary) - 1
    if (method && fn.type === 'MemberExpression') {
      edits.push({ start: fn.start!, end: fn.object.start!, text: `${helper}(${index}, (` })
      edits.push({ start: fn.object.end!, end: fn.end!, text: `), "${method}")` })
    } else {
      edits.push({ start: fn.start!, end: fn.start!, text: `${helper}(${index}, ` })
      edits.push({ start: fn.end!, end: fn.end!, text: ')' })
    }
  }

  function visit(node: Node): void {
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const fn = node.callee
      if (fn.type === 'Identifier' && (fn.name === 'print' || fn.name === 'printjson')) {
        tag(node)
      } else if (fn.type === 'MemberExpression') {
        const key = !fn.computed && fn.property.type === 'Identifier' ? fn.property.name
          : fn.property.type === 'StringLiteral' ? fn.property.value : undefined
        const callback = node.arguments[0]
        if (fn.object.type === 'Identifier' && fn.object.name === 'console' &&
            key && ['log', 'info', 'warn', 'error'].includes(key)) {
          tag(node, key)
        } else if (key === 'forEach' && fn.object.type !== 'Super' && callback?.type === 'Identifier' &&
            (callback.name === 'print' || callback.name === 'printjson')) {
          tag(node, key)
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child)
      } else if (value?.type) visit(value)
    }
  }

  visit(program)
  if (!edits.length) return code
  Object.defineProperty(context, helper, {
    value(index: number, target: unknown, method?: string) {
      const fn = method ? (target as Record<string, unknown>)[method] : target
      if (typeof fn !== 'function') return fn
      if (!method && !captured.has(fn)) return fn
      return (...args: unknown[]) => {
        const receiver = method ? target : undefined
        const printing = method === 'forEach' ? captured.has(args[0]) : captured.has(fn)
        return printing
          ? activeSource.run(sources[index], () => Reflect.apply(fn, receiver, args))
          : Reflect.apply(fn, receiver, args)
      }
    }
  })
  const parts: string[] = []
  let offset = 0
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    parts.push(code.slice(offset, edit.start), edit.text)
    offset = edit.end
  }
  return parts.join('') + code.slice(offset)
}
