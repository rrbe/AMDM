import { EJSON } from 'bson'
import type { CollectionInfo, DatabaseInfo, IndexInfo, UserInfo } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { serializerPool } from '../workers/serializerPool'

function toPlain(value: unknown): Record<string, unknown> {
  return JSON.parse(EJSON.stringify(value, { relaxed: false })) as Record<string, unknown>
}

export async function listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
  const client = sessionManager.getClient(connectionId)
  const res = await client.db('admin').admin().listDatabases()
  return res.databases.map((d) => ({
    name: d.name,
    sizeOnDisk: typeof d.sizeOnDisk === 'number' ? d.sizeOnDisk : undefined,
    empty: d.empty
  }))
}

export async function listCollections(
  connectionId: string,
  database: string
): Promise<CollectionInfo[]> {
  const client = sessionManager.getClient(connectionId)
  // nameOnly keeps this cheap — we deliberately do NOT fetch per-collection
  // counts here (ADR-0004: that's what froze NoSQLBooster on big servers).
  const cols = await client.db(database).listCollections({}, { nameOnly: false }).toArray()
  return cols.map((c) => ({
    name: c.name,
    type: (c.type as CollectionInfo['type']) || 'collection'
  }))
}

export async function listIndexes(
  connectionId: string,
  database: string,
  collection: string
): Promise<IndexInfo[]> {
  const client = sessionManager.getClient(connectionId)
  const idx = await client.db(database).collection(collection).indexes()
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

// --- field sampling for autocomplete (ADR-0004 rule 4: bounded + cached) ---

const SAMPLE_LIMIT = 50
const fieldCache = new Map<string, string[]>()

/**
 * Sample a bounded number of documents and return their (dot-pathed) field
 * names for autocomplete. Cached per connection+namespace for the session.
 * The field extraction runs off the main thread via the serializer worker
 * (ADR-0004 rules 3 & 4).
 */
export async function sampleFields(
  connectionId: string,
  database: string,
  collection: string
): Promise<string[]> {
  const cacheKey = `${connectionId}:${database}.${collection}`
  const cached = fieldCache.get(cacheKey)
  if (cached) return cached

  const client = sessionManager.getClient(connectionId)
  const docs = await client
    .db(database)
    .collection(collection)
    .find({}, { limit: SAMPLE_LIMIT })
    .toArray()

  const fields = await serializerPool.extractFields(docs)
  fieldCache.set(cacheKey, fields)
  return fields
}

export async function listUsers(connectionId: string, database: string): Promise<UserInfo[]> {
  const client = sessionManager.getClient(connectionId)
  try {
    const res = (await client.db(database).command({ usersInfo: 1 })) as {
      users?: Array<{ user: string; db: string; roles: Array<{ role: string; db: string }> }>
    }
    return (res.users ?? []).map((u) => ({ user: u.user, db: u.db, roles: u.roles ?? [] }))
  } catch {
    // Insufficient privileges or unsupported — surface as empty rather than erroring.
    return []
  }
}
