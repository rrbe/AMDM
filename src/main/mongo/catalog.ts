import { EJSON } from 'bson'
import type { MongoClient } from 'mongodb'
import type { CollectionInfo, DatabaseInfo, IndexInfo, UserInfo } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { serializerPool } from '../workers/serializerPool'

function toPlain(value: unknown): Record<string, unknown> {
  return JSON.parse(EJSON.stringify(value, { relaxed: false })) as Record<string, unknown>
}

/**
 * True when an error is the benign result of a concurrent disconnect: a lazy
 * catalog fetch was still in flight when `client.close()` interrupted its
 * checked-out connection (MongoClientClosedError), or the session was already
 * torn down before the op started (getClient → "not open"). The result is no
 * longer needed, so callers swallow these and return an empty result instead
 * of rejecting the IPC handler (which Electron would log as an error).
 */
function isClientClosed(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const closedNames = new Set([
    'MongoClientClosedError',
    'MongoNotConnectedError',
    'MongoTopologyClosedError',
    'MongoExpiredSessionError'
  ])
  if (closedNames.has(err.name)) return true
  return /client was closed|Connection is not open|Topology is closed/i.test(err.message)
}

/** Run a catalog op, treating a concurrent-disconnect race as an empty result. */
async function guardClosed<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if (isClientClosed(err)) return fallback
    throw err
  }
}

export async function listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
  return guardClosed(async () => {
    const client = sessionManager.getClient(connectionId)
    // Two independent admin commands — fire them concurrently so the
    // Compass-parity privilege probe adds no latency on top of listDatabases.
    // authorizedDatabaseNames swallows its own errors, so Promise.all only
    // rejects if listDatabases itself fails (handled by guardClosed).
    const [res, authorizedNames] = await Promise.all([
      client.db('admin').admin().listDatabases(),
      authorizedDatabaseNames(client)
    ])
    const byName = new Map<string, DatabaseInfo>()
    for (const d of res.databases) {
      byName.set(d.name, {
        name: d.name,
        sizeOnDisk: typeof d.sizeOnDisk === 'number' ? d.sizeOnDisk : undefined,
        empty: d.empty
      })
    }
    // Compass parity: a database the user is authorized on but that holds no
    // data yet is NOT returned by listDatabases. Surface those too (as empty),
    // derived from the authenticated user's privileges, so the tree matches
    // what Compass shows (dashed/empty databases).
    for (const name of authorizedNames) {
      if (!byName.has(name)) byName.set(name, { name, empty: true })
    }
    return [...byName.values()]
  }, [])
}

/**
 * Database names the current user is explicitly authorized on, taken from the
 * privileges that `connectionStatus` reports (each privilege's `resource.db`).
 * `showPrivileges: true` flattens every granted role into concrete privileges,
 * so a `readWrite@somedb` grant surfaces `somedb` even when it has no data.
 * Cluster-wide privileges (`resource.db === ''`) are skipped — they target "any
 * database", not a specific one. Never throws: a probe failure (e.g. a user
 * without permission to read its own status) just yields no extra databases.
 */
async function authorizedDatabaseNames(client: MongoClient): Promise<string[]> {
  try {
    const status = (await client
      .db('admin')
      .command({ connectionStatus: 1, showPrivileges: true })) as ConnectionStatus
    const privileges = status.authInfo?.authenticatedUserPrivileges ?? []
    const names = new Set<string>()
    for (const p of privileges) {
      const db = p.resource?.db
      if (typeof db === 'string' && db !== '') names.add(db)
    }
    return [...names]
  } catch {
    return []
  }
}

interface ConnectionStatus {
  authInfo?: {
    authenticatedUserPrivileges?: { resource?: { db?: string } }[]
  }
}

export async function listCollections(
  connectionId: string,
  database: string
): Promise<CollectionInfo[]> {
  return guardClosed(async () => {
    const client = sessionManager.getClient(connectionId)
    // nameOnly keeps this cheap — we deliberately do NOT fetch per-collection
    // counts here (ADR-0004: that's what froze NoSQLBooster on big servers).
    const cols = await client.db(database).listCollections({}, { nameOnly: false }).toArray()
    return cols.map((c) => ({
      name: c.name,
      type: (c.type as CollectionInfo['type']) || 'collection'
    }))
  }, [])
}

export async function listIndexes(
  connectionId: string,
  database: string,
  collection: string
): Promise<IndexInfo[]> {
  return guardClosed(async () => {
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
  }, [])
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

  // On a disconnect race, return [] WITHOUT caching, so a later reconnect re-samples.
  return guardClosed(async () => {
    const client = sessionManager.getClient(connectionId)
    const docs = await client
      .db(database)
      .collection(collection)
      .find({}, { limit: SAMPLE_LIMIT })
      .toArray()

    const fields = await serializerPool.extractFields(docs)
    fieldCache.set(cacheKey, fields)
    return fields
  }, [])
}

export async function listUsers(connectionId: string, database: string): Promise<UserInfo[]> {
  // Insufficient privileges / unsupported (inner catch) and disconnect races
  // (guardClosed) both surface as an empty list rather than an error.
  return guardClosed(async () => {
    const client = sessionManager.getClient(connectionId)
    try {
      const res = (await client.db(database).command({ usersInfo: 1 })) as {
        users?: Array<{ user: string; db: string; roles: Array<{ role: string; db: string }> }>
      }
      return (res.users ?? []).map((u) => ({ user: u.user, db: u.db, roles: u.roles ?? [] }))
    } catch (err) {
      if (isClientClosed(err)) throw err // let guardClosed handle the race
      return []
    }
  }, [])
}
