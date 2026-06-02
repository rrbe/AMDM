import type { DecryptedConnection } from '../mongo/uri'

/**
 * Build the base CLI args for mongodump/mongorestore from a connection.
 *
 * - SSH tunnel active → connect to 127.0.0.1:<tunnelPort> (reuses the session's
 *   forwarder), with --db.
 * - SRV (no tunnel) → a `--uri mongodb+srv://…/<db>` (auth/tls folded in).
 * - plain host → --host/--port/--db + auth + tls flags.
 *
 * `db` is omitted for restore-from-archive (the archive carries namespaces);
 * pass `includeDb: false` there.
 */
export function buildToolBaseArgs(
  dec: DecryptedConnection,
  tunnelPort: number | undefined,
  db: string,
  includeDb = true
): string[] {
  const { config } = dec

  // SRV path: a single --uri string (can't mix with --host/-u flags).
  if (config.useSrv && !tunnelPort) {
    const cred =
      config.auth.type === 'scram' && config.auth.username
        ? `${encodeURIComponent(config.auth.username)}:${encodeURIComponent(dec.password ?? '')}@`
        : ''
    const params: string[] = []
    if (config.auth.type === 'scram' && config.auth.authSource) {
      params.push(`authSource=${encodeURIComponent(config.auth.authSource)}`)
    }
    if (config.tls.enabled) {
      params.push('tls=true')
      if (config.tls.allowInvalidCertificates) params.push('tlsInsecure=true')
      if (config.tls.caFile) params.push(`tlsCAFile=${encodeURIComponent(config.tls.caFile)}`)
      if (config.tls.certificateKeyFile) {
        params.push(`tlsCertificateKeyFile=${encodeURIComponent(config.tls.certificateKeyFile)}`)
      }
    }
    const qs = params.length ? `?${params.join('&')}` : ''
    const path = includeDb ? `/${encodeURIComponent(db)}` : '/'
    return ['--uri', `mongodb+srv://${cred}${config.host}${path}${qs}`]
  }

  // Flags path (plain host or SSH tunnel).
  const args: string[] = []
  if (tunnelPort) {
    args.push('--host', '127.0.0.1', '--port', String(tunnelPort))
  } else {
    args.push('--host', config.host, '--port', String(config.port ?? 27017))
  }
  if (config.auth.type === 'scram' && config.auth.username) {
    args.push('-u', config.auth.username, '-p', dec.password ?? '')
    args.push('--authenticationDatabase', config.auth.authSource || 'admin')
    if (config.auth.mechanism && config.auth.mechanism !== 'DEFAULT') {
      args.push('--authenticationMechanism', config.auth.mechanism)
    }
  }
  if (config.tls.enabled) {
    args.push('--ssl')
    if (config.tls.allowInvalidCertificates) args.push('--sslAllowInvalidCertificates')
    if (config.tls.caFile) args.push('--sslCAFile', config.tls.caFile)
    if (config.tls.certificateKeyFile) args.push('--sslPEMKeyFile', config.tls.certificateKeyFile)
  }
  if (includeDb) args.push('--db', db)
  return args
}
