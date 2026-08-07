import type { ConnectionConfig } from '@shared/types'

export type DropEdge = 'before' | 'after'

/** Apply a remembered id order, leaving new connections at the end. */
export function applyConnectionOrder(
  connections: ConnectionConfig[],
  order: string[] | undefined
): ConnectionConfig[] {
  const remaining = new Map(connections.map((connection) => [connection.id, connection]))
  const sorted: ConnectionConfig[] = []
  for (const id of Array.isArray(order) ? order : []) {
    const connection = remaining.get(id)
    if (connection) {
      sorted.push(connection)
      remaining.delete(id)
    }
  }
  return [...sorted, ...connections.filter((connection) => remaining.has(connection.id))]
}

/** Move one id immediately before or after another. Invalid/no-op moves keep the same array. */
export function reorderConnectionIds(
  ids: string[],
  sourceId: string,
  targetId: string,
  edge: DropEdge
): string[] {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return ids
  const next = ids.filter((id) => id !== sourceId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, sourceId)
  return next.every((id, index) => id === ids[index]) ? ids : next
}
