/**
 * Parse / build MongoDB connection strings. Pure, dependency-free, and shared by
 * both the renderer (form's "From URL" paste-to-parse) and the main process
 * (the "To URL" export, which can inline the decrypted password).
 *
 * Tolerant of the common shapes:
 *   mongodb://user:pass@host:27017/db?replicaSet=rs0&authSource=admin&tls=true
 *   mongodb+srv://user:pass@cluster0.abcde.mongodb.net/db?retryWrites=true
 *
 * Limitation: our connection model stores a single host + an optional replicaSet
 * name. A URI listing multiple seed hosts is parsed to its FIRST host (the
 * driver still discovers the rest of the set from one reachable seed).
 */

export interface ParsedUri {
  useSrv: boolean
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

function splitHostPort(hp: string): { host: string; port: number | null } {
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
  const idx = hp.lastIndexOf(':')
  if (idx >= 0) {
    const port = parseInt(hp.slice(idx + 1), 10)
    return { host: hp.slice(0, idx), port: Number.isFinite(port) ? port : null }
  }
  return { host: hp, port: null }
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
  const m = /^(mongodb(?:\+srv)?):\/\/(.*)$/is.exec(uri)
  if (!m) throw new Error('Not a valid mongodb:// or mongodb+srv:// URI')

  const useSrv = m[1].toLowerCase() === 'mongodb+srv'
  let rest = m[2]

  // query
  let query = ''
  const q = rest.indexOf('?')
  if (q >= 0) {
    query = rest.slice(q + 1)
    rest = rest.slice(0, q)
  }

  // path → default database
  let defaultDatabase = ''
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    defaultDatabase = decodeURIComponent(rest.slice(slash + 1))
    rest = rest.slice(0, slash)
  }

  // userinfo
  let hasAuth = false
  let username = ''
  let password: string | null = null
  const at = rest.lastIndexOf('@')
  let hostPart = rest
  if (at >= 0) {
    hasAuth = true
    const userinfo = rest.slice(0, at)
    hostPart = rest.slice(at + 1)
    const c = userinfo.indexOf(':')
    if (c >= 0) {
      username = decodeURIComponent(userinfo.slice(0, c))
      password = decodeURIComponent(userinfo.slice(c + 1))
    } else {
      username = decodeURIComponent(userinfo)
    }
  }

  const firstHost = hostPart
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0]
  if (!firstHost) throw new Error('No host found in URI')

  const { host, port } = useSrv ? { host: firstHost, port: null } : splitHostPort(firstHost)

  const params = new URLSearchParams(query)
  const replicaSet = params.get('replicaSet') ?? ''
  const authSource = params.get('authSource') ?? ''
  const tlsEnabled = params.get('tls') === 'true' || params.get('ssl') === 'true'
  const tlsAllowInvalid =
    params.get('tlsAllowInvalidCertificates') === 'true' || params.get('tlsInsecure') === 'true'

  const extraOptions: Record<string, string> = {}
  params.forEach((value, key) => {
    if (!MAPPED_OPTION_KEYS.has(key.toLowerCase())) extraOptions[key] = value
  })

  return {
    useSrv,
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

  const hostPart = i.useSrv ? i.host : `${i.host}${i.port ? `:${i.port}` : ''}`
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
