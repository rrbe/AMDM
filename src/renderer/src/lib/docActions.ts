import type { ShellResult } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'

export interface DocActionContext {
  connectionId: string
  database: string
  collection: string
}

type Dict = Record<string, unknown>

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Compute the (conn/db/collection) action context for the current result, or
 * null when doc actions aren't available at all.
 */
export function docActionContext(
  result: ShellResult | null,
  lastQuery: { connectionId: string } | null
): DocActionContext | null {
  if (!result?.documentSource || !lastQuery) return null
  return {
    connectionId: lastQuery.connectionId,
    ...result.documentSource
  }
}

/** Whether a specific document supports actions (must be an object with _id). */
export function docHasId(doc: unknown): doc is Dict & { _id: unknown } {
  return isPlainObject(doc) && Object.prototype.hasOwnProperty.call(doc, '_id') && doc._id !== undefined
}

/**
 * Confirm + delete a document via the store. Returns a promise; callers may
 * ignore it (the store auto-refreshes the result on success).
 */
export async function confirmDeleteDoc(ctx: DocActionContext, id: unknown): Promise<void> {
  if (!window.confirm('Delete this document? This cannot be undone.')) return
  await useAppStore.getState().deleteDocument({
    connectionId: ctx.connectionId,
    database: ctx.database,
    collection: ctx.collection,
    id
  })
}
