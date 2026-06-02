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
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000
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
