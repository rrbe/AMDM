import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

/**
 * Prefer a locally cached mongod binary so the suite never touches the network.
 * mongodb-memory-server's default cache dir is ~/.cache/mongodb-binaries.
 */
const CACHE = join(homedir(), '.cache', 'mongodb-binaries')
const CANDIDATES = ['mongod-arm64-darwin-7.0.14', 'mongod-arm64-darwin-8.2.1'].map((n) =>
  join(CACHE, n)
)

/** Locate a cached mongod and read its version out of the filename. */
function cachedBinary(): { systemBinary: string; version: string } | undefined {
  const path = CANDIDATES.find((p) => existsSync(p))
  if (!path) return undefined
  const version = /(\d+\.\d+\.\d+)$/.exec(path)?.[1] ?? '7.0.14'
  return { systemBinary: path, version }
}

export interface MongoHarness {
  server: MongoMemoryServer
  client: MongoClient
  stop: () => Promise<void>
}

/** Boot an in-process MongoDB and a connected client. */
export async function startMongo(): Promise<MongoHarness> {
  const bin = cachedBinary()
  const server = await MongoMemoryServer.create(bin ? { binary: bin } : undefined)
  const client = new MongoClient(server.getUri())
  await client.connect()
  return {
    server,
    client,
    stop: async () => {
      await client.close().catch(() => {})
      await server.stop()
    }
  }
}
