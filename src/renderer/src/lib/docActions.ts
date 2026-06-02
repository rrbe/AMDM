/**
 * Shared helpers for per-document Edit/Delete actions in the result views.
 *
 * Doc actions are only available when:
 *   - the result has a `collection` (parsed from the query), AND
 *   - `lastQuery` is non-null (so we know the target conn/db), AND
 *   - the specific document is a plain object with an `_id`.
 *
 * Target connection/database come from `lastQuery`; the collection from the
 * result. The `_id` is passed straight through to the store as the EJSON value.
 */
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
  lastQuery: { connectionId: string; database: string } | null
): DocActionContext | null {
  if (!result || !result.collection || !lastQuery) return null
  return {
    connectionId: lastQuery.connectionId,
    database: lastQuery.database,
    collection: result.collection
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
