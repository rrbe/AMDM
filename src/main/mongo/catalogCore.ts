/**
 * Catalog read core (ADR-0003 pattern: driver-only core + thin session
 * wrapper). These take a `Db` directly — no `sessionManager` — so they can be
 * integration-tested against a real MongoDB. `catalog.ts` wraps them with
 * session resolution, the disconnect-race guard, and field-sample caching.
 */
import { EJSON } from 'bson'
import type { Db } from 'mongodb'
import type { CollectionInfo, IndexInfo } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'

/** BSON → EJSON-canonical plain object (used for index key specs). */
export function toPlain(value: unknown): Record<string, unknown> {
  return JSON.parse(EJSON.stringify(value, { relaxed: false })) as Record<string, unknown>
}

export async function listCollectionsOnDb(db: Db): Promise<CollectionInfo[]> {
  // nameOnly:false to read `type` (collection/view/timeseries); we deliberately
  // do NOT fetch per-collection counts here (ADR-0004).
  const cols = await db.listCollections({}, { nameOnly: false }).toArray()
  return cols.map((c) => ({
    name: c.name,
    type: (c.type as CollectionInfo['type']) || 'collection'
  }))
}

export async function listIndexesOnDb(db: Db, collection: string): Promise<IndexInfo[]> {
  const idx = await db.collection(collection).indexes()
  return idx.map((i) => {
    const raw = i as Record<string, unknown>
    return {
      name: String(raw.name),
      key: toPlain(raw.key),
      unique: raw.unique === true,
      sparse: raw.sparse === true,
      ttlSeconds: typeof raw.expireAfterSeconds === 'number' ? raw.expireAfterSeconds : undefined
    }
  })
}

export async function sampleFieldsOnDb(
  db: Db,
  collection: string,
  limit: number
): Promise<string[]> {
  const docs = await db.collection(collection).find({}, { limit }).toArray()
  // Field extraction runs off the main thread via the serializer worker, with
  // an inline fallback (ADR-0004 rules 3 & 4).
  return serializerPool.extractFields(docs)
}
