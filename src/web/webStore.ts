import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { buildMongoUri } from '../shared/connectionUri'
import {
  DEFAULT_SETTINGS,
  HISTORY_LIMITS,
  QUERY_LIMITS,
  QUERY_TIMEOUTS_MS,
  type AppSettings,
  type ConnectionConfig,
  type ConnectionInput,
  type HistoryEntry,
  type SavedQuery,
  type SavedQueryInput
} from '../shared/types'
import type { DecryptedConnection } from '../main/mongo/uri'
import type { ConnectionSource } from '../main/mongo/sessionManager'

interface StoredConnection extends Omit<ConnectionConfig, 'hasPassword'> {
  encPassword?: string
}

interface UserState {
  version: 1
  user: string
  connections: StoredConnection[]
  queries: SavedQuery[]
  history: HistoryEntry[]
  settings: AppSettings
}

export interface AuditEntry {
  user: string
  action: 'shell' | 'doc:update' | 'doc:setField' | 'doc:delete'
  connectionId: string
  database: string
  collection?: string
  documentId?: unknown
  ok: boolean
}

const PASSWORD_PLACEHOLDER = '<password>'

function userKey(user: string): string {
  return createHash('sha256').update(user).digest('hex')
}

function emptyState(user: string): UserState {
  return {
    version: 1,
    user,
    connections: [],
    queries: [],
    history: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

/** Single-instance, JSON-backed Web state. Move to shared storage only when HA is required. */
export class WebStore implements ConnectionSource {
  private readonly users = new Map<string, UserState>()

  constructor(
    private readonly root: string,
    private readonly key: Buffer
  ) {
    if (key.length !== 32) throw new Error('AMDM_WEB_MASTER_KEY must decode to exactly 32 bytes.')
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  private statePath(key: string): string {
    return join(this.root, 'users', key, 'state.json')
  }

  private load(user: string): UserState {
    const key = userKey(user)
    const cached = this.users.get(key)
    if (cached) {
      if (cached.user !== user) throw new Error('User identity collision.')
      return cached
    }

    const path = this.statePath(key)
    let state = emptyState(user)
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<UserState>
      if (parsed.user !== user) throw new Error('Stored user identity does not match.')
      state = {
        version: 1,
        user,
        connections: parsed.connections ?? [],
        queries: parsed.queries ?? [],
        history: parsed.history ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
      }
    }
    this.users.set(key, state)
    return state
  }

  private loadByKey(key: string): UserState | null {
    const cached = this.users.get(key)
    if (cached) return cached
    const path = this.statePath(key)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<UserState>
    if (!parsed.user) return null
    return this.load(parsed.user)
  }

  private persist(state: UserState): void {
    const path = this.statePath(userKey(state.user))
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temp, path)
    chmodSync(path, 0o600)
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':')
  }

  private decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(':')
    if (version !== 'v1' || !iv || !tag || encrypted === undefined) {
      throw new Error('Stored credential is invalid.')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
  }

  private sanitize(connection: StoredConnection): ConnectionConfig {
    const { encPassword, ...config } = connection
    return { ...config, hasPassword: !!encPassword }
  }

  private connection(user: string, id: string): StoredConnection {
    const connection = this.load(user).connections.find((item) => item.id === id)
    if (!connection) throw new Error('Connection not found.')
    return connection
  }

  listConnections(user: string): ConnectionConfig[] {
    return this.load(user).connections.map((item) => this.sanitize(item))
  }

  saveConnection(user: string, input: ConnectionInput): ConnectionConfig {
    if (input.ssh.enabled) throw new Error('SSH connections are not supported on the Web build.')
    const state = this.load(user)
    const existing = input.id ? state.connections.find((item) => item.id === input.id) : undefined

    const now = Date.now()
    const stored: StoredConnection = {
      id: input.id || randomUUID(),
      name: input.name,
      color: input.color,
      useSrv: input.useSrv,
      host: input.host,
      port: input.port,
      replicaSet: input.replicaSet,
      defaultDatabase: input.defaultDatabase,
      options: input.options,
      auth: input.auth,
      ssh: { enabled: false },
      tls: input.tls,
      encPassword:
        input.password === undefined
          ? existing?.encPassword
          : input.password === ''
            ? undefined
            : this.encrypt(input.password),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    if (existing) state.connections[state.connections.indexOf(existing)] = stored
    else state.connections.push(stored)
    this.persist(state)
    return this.sanitize(stored)
  }

  deleteConnection(user: string, id: string): void {
    const state = this.load(user)
    if (!state.connections.some((item) => item.id === id)) throw new Error('Connection not found.')
    state.connections = state.connections.filter((item) => item.id !== id)
    state.settings.connectionOrder = state.settings.connectionOrder.filter((item) => item !== id)
    this.persist(state)
  }

  decryptedInput(user: string, input: ConnectionInput): DecryptedConnection {
    const existing = input.id ? this.load(user).connections.find((item) => item.id === input.id) : undefined
    const savedPassword = existing?.encPassword ? this.decrypt(existing.encPassword) : undefined
    const {
      password,
      sshPassword: _sshPassword,
      sshPassphrase: _sshPassphrase,
      jumpSshPassphrase: _jump,
      ...rest
    } = input
    return {
      config: {
        ...rest,
        id: input.id ?? '',
        ssh: { enabled: false },
        hasPassword: !!(password || savedPassword),
        createdAt: existing?.createdAt ?? 0,
        updatedAt: existing?.updatedAt ?? 0
      },
      password: password || savedPassword
    }
  }

  buildConnectionUri(user: string, input: ConnectionInput, includePassword: boolean): string {
    const scram = input.auth.type === 'scram' && !!input.auth.username?.trim()
    const existing = input.id ? this.load(user).connections.find((item) => item.id === input.id) : undefined
    let password: string | undefined
    let encodePassword = true
    if (scram) {
      if (includePassword) {
        password = input.password || (existing?.encPassword ? this.decrypt(existing.encPassword) : undefined)
      } else {
        password = PASSWORD_PLACEHOLDER
        encodePassword = false
      }
    }
    return buildMongoUri({
      useSrv: input.useSrv,
      host: input.host.trim(),
      port: input.useSrv ? null : (input.port ?? 27017),
      replicaSet: input.replicaSet?.trim() || undefined,
      defaultDatabase: input.defaultDatabase?.trim() || undefined,
      authType: input.auth.type,
      username: input.auth.username?.trim() || undefined,
      password,
      encodePassword,
      authSource: input.auth.authSource?.trim() || undefined,
      tlsEnabled: input.tls.enabled,
      tlsAllowInvalid: !!input.tls.allowInvalidCertificates,
      options: input.options
    })
  }

  sessionId(user: string, connectionId: string): string {
    this.connection(user, connectionId)
    return `${userKey(user)}:${connectionId}`
  }

  getDecrypted(sessionId: string): DecryptedConnection | null {
    const separator = sessionId.indexOf(':')
    if (separator !== 64) return null
    const state = this.loadByKey(sessionId.slice(0, separator))
    const stored = state?.connections.find((item) => item.id === sessionId.slice(separator + 1))
    if (!stored) return null
    return {
      config: { ...this.sanitize(stored), id: sessionId },
      password: stored.encPassword ? this.decrypt(stored.encPassword) : undefined
    }
  }

  listQueries(user: string): SavedQuery[] {
    return this.load(user).queries
  }

  saveQuery(user: string, input: SavedQueryInput): SavedQuery {
    const state = this.load(user)
    const now = Date.now()
    const existing = input.id ? state.queries.find((item) => item.id === input.id) : undefined
    const query: SavedQuery = {
      id: existing?.id ?? randomUUID(),
      name: input.name,
      code: input.code,
      connectionId: input.connectionId,
      database: input.database,
      folder: input.folder?.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    if (existing) state.queries[state.queries.indexOf(existing)] = query
    else state.queries.push(query)
    this.persist(state)
    return query
  }

  deleteQuery(user: string, id: string): void {
    const state = this.load(user)
    state.queries = state.queries.filter((item) => item.id !== id)
    this.persist(state)
  }

  listHistory(user: string): HistoryEntry[] {
    const state = this.load(user)
    const limit = Math.max(1, Math.floor(state.settings.historyLimit) || 1)
    if (state.history.length > limit) {
      state.history.length = limit
      this.persist(state)
    }
    return state.history
  }

  addHistory(user: string, entry: Omit<HistoryEntry, 'id' | 'ranAt'>): void {
    const state = this.load(user)
    state.history.unshift({ id: randomUUID(), ranAt: Date.now(), ...entry })
    state.history.length = Math.min(state.history.length, Math.max(1, state.settings.historyLimit))
    this.persist(state)
  }

  clearHistory(user: string): void {
    const state = this.load(user)
    state.history = []
    this.persist(state)
  }

  getSettings(user: string): AppSettings {
    return this.load(user).settings
  }

  updateSettings(user: string, patch: Partial<AppSettings>): AppSettings {
    const state = this.load(user)
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS))
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('Invalid settings patch.')
    const next = { ...state.settings, ...patch }
    const numbers = [
      next.sidebarWidth,
      next.editorHeight,
      next.queryLimit,
      next.queryTimeoutMS,
      next.historyLimit,
      next.editorFontSize,
      next.dataFontSize,
      next.editorTabSize
    ]
    if (
      !Array.isArray(next.connectionOrder) ||
      !next.connectionOrder.every((item) => typeof item === 'string') ||
      !['natural', 'alpha'].includes(next.collectionSort) ||
      !['light', 'dark', 'system'].includes(next.theme) ||
      !['system', 'en', 'zh-CN', 'zh-TW'].includes(next.language) ||
      numbers.some((item) => !Number.isFinite(item)) ||
      !QUERY_LIMITS.includes(next.queryLimit as (typeof QUERY_LIMITS)[number]) ||
      !QUERY_TIMEOUTS_MS.includes(next.queryTimeoutMS as (typeof QUERY_TIMEOUTS_MS)[number]) ||
      !HISTORY_LIMITS.includes(next.historyLimit as (typeof HISTORY_LIMITS)[number]) ||
      next.sidebarWidth < 200 ||
      next.sidebarWidth > 10_000 ||
      next.editorHeight < 80 ||
      next.editorHeight > 10_000 ||
      next.editorFontSize < 9 ||
      next.editorFontSize > 28 ||
      next.dataFontSize < 9 ||
      next.dataFontSize > 28 ||
      ![2, 4].includes(next.editorTabSize) ||
      typeof next.editorWordWrap !== 'boolean' ||
      typeof next.activeEditorColorSchemeId !== 'string' ||
      !Array.isArray(next.editorColorSchemes) ||
      typeof next.exportIncludeRealPassword !== 'boolean'
    ) {
      throw new Error('Invalid settings patch.')
    }
    state.settings = next
    this.persist(state)
    return state.settings
  }

  audit(entry: AuditEntry): void {
    const path = join(this.root, 'audit.ndjson')
    appendFileSync(path, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    chmodSync(path, 0o600)
  }
}

export function decodeMasterKey(value: string | undefined): Buffer {
  if (!value) throw new Error('AMDM_WEB_MASTER_KEY is required (32 random bytes, base64-encoded).')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('AMDM_WEB_MASTER_KEY must decode to exactly 32 bytes.')
  return key
}
