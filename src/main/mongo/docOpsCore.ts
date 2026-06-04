/**
 * Document mutation core (ADR-0003 pattern: pure-ish core + thin session
 * wrapper). These operate on a driver `Db` directly — no `sessionManager` — so
 * they can be integration-tested against a real MongoDB. `docOps.ts` is the
 * thin wrapper that resolves the active client and delegates here.
 */
import { EJSON } from 'bson'
import type { Db, Document } from 'mongodb'
import type { DocMutateResult } from '../../shared/types'

/** Turn an EJSON-canonical value (e.g. {$oid}) back into a BSON value. */
export function deserializeId(id: unknown): unknown {
  if (id !== null && typeof id === 'object') {
    // EJSON.deserialize promotes a $numberLong to a lossy JS number, which would
    // corrupt a large NumberLong _id and target the WRONG document (or none) on
    // edit/delete. Round-trip through canonical parse to keep the exact BSON type.
    return EJSON.parse(JSON.stringify(id), { relaxed: false })
  }
  return id // plain string/number _id
}

/**
 * Replace a document by _id. The user-edited EJSON string is parsed back to
 * BSON; any _id inside the replacement is dropped so the original _id (from the
 * filter) is preserved (Mongo forbids changing _id on replace).
 */
export async function replaceDocumentOnDb(
  db: Db,
  collection: string,
  id: unknown,
  documentEjson: string
): Promise<DocMutateResult> {
  try {
    const _id = deserializeId(id)
    // relaxed:false keeps numeric BSON types intact ($numberLong → Long,
    // $numberInt → Int32) instead of collapsing them to JS numbers (Double).
    const doc = EJSON.parse(documentEjson, { relaxed: false }) as Record<string, unknown>
    if ('_id' in doc) delete doc._id
    const res = await db.collection(collection).replaceOne({ _id } as Document, doc as Document)
    return { ok: true, matched: res.matchedCount, modified: res.modifiedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Surgically set ONE field by _id via `$set` (inline cell editing). The new
 * value arrives as an EJSON string and is parsed back to BSON, so types are
 * preserved (ObjectId stays ObjectId, etc.). `_id` cannot be changed.
 */
export async function setFieldOnDb(
  db: Db,
  collection: string,
  id: unknown,
  path: string,
  valueEjson: string
): Promise<DocMutateResult> {
  try {
    if (!path || path === '_id') {
      return { ok: false, error: `Cannot edit field "${path}".` }
    }
    const _id = deserializeId(id)
    // relaxed:false so an inline-edited $numberLong/$numberInt keeps its BSON
    // type (the whole point of cellEdit emitting wrapped numbers).
    const value = EJSON.parse(valueEjson, { relaxed: false })
    const res = await db
      .collection(collection)
      .updateOne({ _id } as Document, { $set: { [path]: value } })
    return { ok: true, matched: res.matchedCount, modified: res.modifiedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteDocumentOnDb(
  db: Db,
  collection: string,
  id: unknown
): Promise<DocMutateResult> {
  try {
    const _id = deserializeId(id)
    const res = await db.collection(collection).deleteOne({ _id } as Document)
    return { ok: true, deleted: res.deletedCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
