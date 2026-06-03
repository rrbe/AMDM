import { EJSON } from 'bson'
import type { Document } from 'mongodb'
import type {
  DocMutateRequest,
  DocMutateResult,
  DocSetFieldRequest,
  DocUpdateRequest
} from '../../shared/types'
import { sessionManager } from './sessionManager'

/** Turn an EJSON-canonical value (e.g. {$oid}) back into a BSON value. */
function deserializeId(id: unknown): unknown {
  if (id !== null && typeof id === 'object') {
    return EJSON.deserialize(id as Document)
  }
  return id // plain string/number _id
}

/**
 * Replace a document by _id. The user-edited EJSON string is parsed back to
 * BSON; any _id inside the replacement is dropped so the original _id (from the
 * filter) is preserved (Mongo forbids changing _id on replace).
 */
export async function updateDocument(req: DocUpdateRequest): Promise<DocMutateResult> {
  try {
    const client = sessionManager.getClient(req.connectionId)
    const _id = deserializeId(req.id)
    const doc = EJSON.parse(req.documentEjson) as Record<string, unknown>
    if ('_id' in doc) delete doc._id
    const col = client.db(req.database).collection(req.collection)
    const res = await col.replaceOne({ _id } as Document, doc as Document)
    return { ok: true, matched: res.matchedCount, modified: res.modifiedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Surgically set ONE field by _id via `$set` (used by inline cell editing). The
 * new value arrives as an EJSON string and is parsed back to BSON, so types are
 * preserved (ObjectId stays ObjectId, etc.). `_id` cannot be changed.
 */
export async function setDocumentField(req: DocSetFieldRequest): Promise<DocMutateResult> {
  try {
    if (!req.path || req.path === '_id') {
      return { ok: false, error: `Cannot edit field "${req.path}".` }
    }
    const client = sessionManager.getClient(req.connectionId)
    const _id = deserializeId(req.id)
    const value = EJSON.parse(req.valueEjson)
    const col = client.db(req.database).collection(req.collection)
    const res = await col.updateOne({ _id } as Document, { $set: { [req.path]: value } })
    return { ok: true, matched: res.matchedCount, modified: res.modifiedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteDocument(req: DocMutateRequest): Promise<DocMutateResult> {
  try {
    const client = sessionManager.getClient(req.connectionId)
    const _id = deserializeId(req.id)
    const col = client.db(req.database).collection(req.collection)
    const res = await col.deleteOne({ _id } as Document)
    return { ok: true, deleted: res.deletedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
