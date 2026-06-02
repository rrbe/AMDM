import { EJSON } from 'bson'
import type { Document } from 'mongodb'
import type { DocMutateRequest, DocMutateResult, DocUpdateRequest } from '../../shared/types'
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
