/**
 * Pure core for connection backup (no Electron / fs / store deps), so the
 * shape + validation logic is unit-testable. The effectful wrapper
 * (connectionBackup.ts) handles the native dialog, file IO, and the keychain-
 * backed store. Secrets never appear here — they aren't part of
 * {@link ConnectionConfig} (only `hasPassword`-style indicator flags are).
 */
import type { ConnectionConfig, ConnectionInput } from '../../shared/types'

export const BACKUP_VERSION = 1

/** A connection sans id/timestamps (and, by construction, sans plaintext secrets). */
export type ExportedConnection = Omit<ConnectionConfig, 'id' | 'createdAt' | 'updatedAt'>

/** A validated import entry — a ConnectionInput minus the id (the store mints one). */
export type ImportedConnection = Omit<ConnectionInput, 'id'>

export interface ConnectionsBackup {
  version: number
  exportedAt: number
  connections: ExportedConnection[]
}

function toExported(c: ConnectionConfig): ExportedConnection {
  const { id, createdAt, updatedAt, ...rest } = c
  return rest
}

/** Build the serializable backup object from the (already secret-free) configs. */
export function buildBackup(conns: ConnectionConfig[], now: number): ConnectionsBackup {
  return { version: BACKUP_VERSION, exportedAt: now, connections: conns.map(toExported) }
}

/**
 * Coerce parsed JSON (our wrapper object OR a bare array) into the list of valid
 * import entries. Unrecognized / malformed entries are skipped rather than
 * aborting the whole import. Returns null when the top-level shape is unusable.
 */
export function parseBackupConnections(parsed: unknown): ImportedConnection[] | null {
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as Partial<ConnectionsBackup> | null)?.connections
  if (!Array.isArray(list)) return null
  const out: ImportedConnection[] = []
  for (const raw of list) {
    const item = toImport(raw)
    if (item) out.push(item)
  }
  return out
}

/** Validate one entry; null if it lacks the fields needed to rebuild a connection. */
function toImport(raw: unknown): ImportedConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<ConnectionConfig>
  if (typeof c.name !== 'string' || typeof c.host !== 'string') return null
  if (!c.auth || !c.ssh || !c.tls) return null
  // Deliberately omit any secret-ish fields; only non-sensitive config is kept.
  return {
    name: c.name,
    color: c.color,
    useSrv: !!c.useSrv,
    host: c.host,
    port: c.port,
    replicaSet: c.replicaSet,
    defaultDatabase: c.defaultDatabase,
    options: c.options,
    auth: c.auth,
    ssh: c.ssh,
    tls: c.tls
  }
}
