import type { MongoClientOptions } from 'mongodb'
import type { ConnectionConfig } from '../../shared/types'

export interface DecryptedConnection {
  config: ConnectionConfig
  password?: string
  sshPassword?: string
  sshPassphrase?: string
}

export interface ClientArgs {
  uri: string
  options: MongoClientOptions
}

/**
 * Build the MongoClient URI + options from a connection config.
 *
 * When `localTunnelPort` is provided (SSH enabled), we point the driver at
 * 127.0.0.1:<port> with directConnection — topology discovery via real
 * hostnames won't work through a single forwarded socket.
 */
export function buildClientArgs(dec: DecryptedConnection, localTunnelPort?: number): ClientArgs {
  const { config } = dec
  const options: MongoClientOptions = {
    // Driver defaults (30s) — deliberately not shorter. connectTimeoutMS
    // doubles as the heartbeat (monitor) socket timeout, and
    // serverSelectionTimeoutMS bounds every operation's server selection:
    // at the old 8s, a server pegged by a heavy query (or a saturated SSH
    // tunnel) missed heartbeats, got marked Unknown, and the cleared pool
    // killed the in-flight slow query. Queries themselves have no
    // client-side timeout (socketTimeoutMS stays 0, like NoSQLBooster);
    // long runs are cancelled via the Stop button, not a deadline.
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 30_000
  }

  let uri: string
  if (localTunnelPort) {
    uri = `mongodb://127.0.0.1:${localTunnelPort}`
    options.directConnection = true
  } else if (config.useSrv) {
    uri = `mongodb+srv://${config.host}`
  } else {
    uri = `mongodb://${config.host}:${config.port ?? 27017}`
    if (config.replicaSet) options.replicaSet = config.replicaSet
  }

  // Auth
  if (config.auth.type === 'scram' && config.auth.username) {
    options.auth = { username: config.auth.username, password: dec.password ?? '' }
    options.authSource = config.auth.authSource || 'admin'
    if (config.auth.mechanism && config.auth.mechanism !== 'DEFAULT') {
      options.authMechanism = config.auth.mechanism
    }
  }

  // TLS
  if (config.tls.enabled) {
    options.tls = true
    if (config.tls.allowInvalidCertificates) {
      options.tlsAllowInvalidCertificates = true
      options.tlsAllowInvalidHostnames = true
    }
    if (config.tls.caFile) options.tlsCAFile = config.tls.caFile
    if (config.tls.certificateKeyFile) options.tlsCertificateKeyFile = config.tls.certificateKeyFile
  }

  // Extra string options (best-effort passthrough)
  if (config.options) {
    Object.assign(options as Record<string, unknown>, config.options)
  }

  return { uri, options }
}
