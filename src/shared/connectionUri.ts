/**
 * Parse / build MongoDB connection strings. Shared by the renderer (form's
 * "From URL" paste-to-parse) and the main process (the "To URL" export, which
 * can inline the decrypted password).
 *
 * Tolerant of the common shapes:
 *   mongodb://user:pass@host:27017/db?replicaSet=rs0&authSource=admin&tls=true
 *   mongodb+srv://user:pass@cluster0.abcde.mongodb.net/db?retryWrites=true
 *
 */

import ConnectionString from 'mongodb-connection-string-url'

export interface ParsedUri {
  useSrv: boolean
  /** Every seed exactly as written in the URI (host or host:port). */
  hosts: string[]
  /** First seed split for backwards-compatible callers. */
  host: string
  port: number | null
  replicaSet: string
  defaultDatabase: string
  hasAuth: boolean
  username: string
  /** null = no password component present in the URI. */
  password: string | null
  authSource: string
  tlsEnabled: boolean
  tlsAllowInvalid: boolean
  /** Options other than the ones mapped to dedicated fields. */
  extraOptions: Record<string, string>
}

export interface BuildUriInput {
  useSrv: boolean
  host: string
  port?: number | null
  replicaSet?: string
  defaultDatabase?: string
  authType: 'none' | 'scram'
  username?: string
  /** Included only when non-empty. */
  password?: string
  /**
   * When false, the password is inserted verbatim (no percent-encoding) — used
   * for a readable `<password>` placeholder in exported strings. Default true.
   */
  encodePassword?: boolean
  authSource?: string
  tlsEnabled: boolean
  tlsAllowInvalid: boolean
  options?: Record<string, string>
}

export function splitHostPort(hp: string): { host: string; port: number | null } {
  // IPv6 literal: [::1]:27017
  if (hp.startsWith('[')) {
    const end = hp.indexOf(']')
    if (end >= 0) {
      const host = hp.slice(1, end)
      const after = hp.slice(end + 1)
      const port = after.startsWith(':') ? parseInt(after.slice(1), 10) : NaN
      return { host, port: Number.isFinite(port) ? port : null }
    }
  }
  // An unbracketed IPv6 literal has multiple colons and no unambiguous port.
  if ((hp.match(/:/g) ?? []).length > 1) return { host: hp, port: null }
  const idx = hp.lastIndexOf(':')
  if (idx >= 0) {
    const port = parseInt(hp.slice(idx + 1), 10)
    return { host: hp.slice(0, idx), port: Number.isFinite(port) ? port : null }
  }
  return { host: hp, port: null }
}

/**
 * Resolve the saved host field to a MongoDB seed list. New connections keep
 * each member's port inline (`h1:27017,h2:27018`); `port` only supports older
 * saved connections that stored one bare host and one separate port.
 */
export function formatMongoHosts(host: string, port?: number | null): string {
  const hosts = host
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (hosts.length !== 1 || port == null) return hosts.join(',')

  const first = splitHostPort(hosts[0])
  if (first.port != null) return hosts[0]
  const hostname = first.host.includes(':') ? `[${first.host}]` : first.host
  return `${hostname}:${port}`
}

const MAPPED_OPTION_KEYS = new Set([
  'replicaset',
  'authsource',
  'tls',
  'ssl',
  'tlsallowinvalidcertificates',
  'tlsinsecure'
])

export function parseMongoUri(raw: string): ParsedUri {
  const uri = raw.trim()
  const parsed = new ConnectionString(uri)
  const useSrv = parsed.isSRV
  const hosts = parsed.hosts
  const { host, port } = useSrv ? { host: hosts[0], port: null } : splitHostPort(hosts[0])
  const authority = uri.slice(uri.indexOf('://') + 3).split(/[/?]/, 1)[0]
  const userinfo = authority.includes('@') ? authority.slice(0, authority.lastIndexOf('@')) : ''
  const hasAuth = authority.includes('@')
  const hasPassword = hasAuth && userinfo.includes(':')
  const username = hasAuth ? decodeURIComponent(parsed.username) : ''
  const password = hasPassword ? decodeURIComponent(parsed.password) : null
  const defaultDatabase = decodeURIComponent(parsed.pathname.slice(1))
  const params = parsed.searchParams
  const replicaSet = params.get('replicaSet') ?? ''
  // MongoDB URI semantics: authenticated URIs default authSource to the path
  // database, then to admin when no path is present.
  const authSource = params.get('authSource') ?? (hasAuth ? defaultDatabase : '')
  const tlsEnabled =
    params.get('tls')?.toLowerCase() === 'true' || params.get('ssl')?.toLowerCase() === 'true'
  const tlsAllowInvalid =
    params.get('tlsAllowInvalidCertificates')?.toLowerCase() === 'true' ||
    params.get('tlsInsecure')?.toLowerCase() === 'true'

  const extraOptions: Record<string, string> = {}
  params.forEach((value: string, key: string) => {
    if (!MAPPED_OPTION_KEYS.has(key.toLowerCase())) extraOptions[key] = value
  })

  return {
    useSrv,
    hosts,
    host,
    port,
    replicaSet,
    defaultDatabase,
    hasAuth,
    username,
    password,
    authSource,
    tlsEnabled,
    tlsAllowInvalid,
    extraOptions
  }
}

export function buildMongoUri(i: BuildUriInput): string {
  const scheme = i.useSrv ? 'mongodb+srv' : 'mongodb'

  let auth = ''
  if (i.authType === 'scram' && i.username) {
    auth = encodeURIComponent(i.username)
    if (i.password) {
      auth += `:${i.encodePassword === false ? i.password : encodeURIComponent(i.password)}`
    }
    auth += '@'
  }

  const hostPart = i.useSrv ? i.host.trim() : formatMongoHosts(i.host, i.port)
  const path = i.defaultDatabase ? `/${encodeURIComponent(i.defaultDatabase)}` : ''

  const params: string[] = []
  if (i.replicaSet) params.push(`replicaSet=${encodeURIComponent(i.replicaSet)}`)
  if (i.authType === 'scram' && i.authSource) {
    params.push(`authSource=${encodeURIComponent(i.authSource)}`)
  }
  if (i.tlsEnabled) params.push('tls=true')
  if (i.tlsAllowInvalid) params.push('tlsAllowInvalidCertificates=true')
  for (const [k, v] of Object.entries(i.options ?? {})) {
    params.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }

  const qs = params.length ? `?${params.join('&')}` : ''
  return `${scheme}://${auth}${hostPart}${path}${qs}`
}
