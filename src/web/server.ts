import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import type {
  AppSettings,
  ConnectionInput,
  DocMutateRequest,
  DocSetFieldRequest,
  DocUpdateRequest,
  SavedQueryInput,
  ShellRequest
} from '../shared/types'
import { SessionManager } from '../main/mongo/sessionManager'
import {
  estimateCollectionCount,
  listCollections,
  listDatabases,
  listIndexes,
  listUsers,
  sampleFields
} from '../main/mongo/catalog'
import { abortShell, executeShell } from '../main/mongo/shellEngine'
import { deleteDocument, setDocumentField, updateDocument } from '../main/mongo/docOps'
import { WebStore } from './webStore'

const MAX_BODY_BYTES = 1024 * 1024

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export interface WebServerOptions {
  store: WebStore
  origin: string
  staticDir: string
}

interface RpcBody {
  method: string
  args: unknown[]
}

function historySummary(kind: string, count?: number, elapsedMs?: number, errorName?: string): string {
  if (kind === 'documents') return `${count ?? 0} docs · ${elapsedMs ?? 0}ms`
  if (kind === 'explain') return `explain · ${elapsedMs ?? 0}ms`
  if (kind === 'error') return errorName ?? 'error'
  return `${kind} · ${elapsedMs ?? 0}ms`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<RpcBody> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<RpcBody>
        if (!value || typeof value.method !== 'string' || !Array.isArray(value.args)) {
          throw new Error('Invalid RPC request.')
        }
        resolveBody({ method: value.method, args: value.args })
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function userFrom(req: IncomingMessage): string {
  const raw = req.headers['x-forwarded-user']
  if (typeof raw !== 'string') throw new Error('Authentication required.')
  const user = raw.trim()
  if (!user || user.length > 256 || /[\u0000-\u001f\u007f]/.test(user)) {
    throw new Error('Invalid authenticated user.')
  }
  return user
}

function objectArg(args: unknown[], index: number): Record<string, unknown> {
  const value = args[index]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid RPC arguments.')
  return value as Record<string, unknown>
}

function stringArg(args: unknown[], index: number): string {
  const value = args[index]
  if (typeof value !== 'string' || !value) throw new Error('Invalid RPC arguments.')
  return value
}

function connectionInput(args: unknown[], index = 0): ConnectionInput {
  const value = objectArg(args, index)
  const auth = value.auth as Record<string, unknown> | undefined
  const ssh = value.ssh as Record<string, unknown> | undefined
  const tls = value.tls as Record<string, unknown> | undefined
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.host !== 'string' ||
    !value.host.trim() ||
    typeof value.useSrv !== 'boolean' ||
    !auth ||
    !['none', 'scram'].includes(String(auth.type)) ||
    !ssh ||
    ssh.enabled !== false ||
    !tls ||
    typeof tls.enabled !== 'boolean'
  ) {
    throw new Error('Invalid connection input.')
  }
  if (value.options) {
    const options = objectArg([value.options], 0)
    if (Object.values(options).some((item) => typeof item !== 'string')) {
      throw new Error('Invalid connection options.')
    }
  }
  return value as unknown as ConnectionInput
}

function shellRequest(args: unknown[], store: WebStore, user: string): ShellRequest {
  const value = objectArg(args, 0)
  const connectionId = String(value.connectionId ?? '')
  const database = String(value.database ?? '')
  const code = value.code
  if (!connectionId || !database || typeof code !== 'string') throw new Error('Invalid Shell request.')
  return {
    ...(value as unknown as ShellRequest),
    connectionId: store.sessionId(user, connectionId),
    execId:
      typeof value.execId === 'string' && value.execId
        ? `${createHash('sha256').update(user).digest('hex')}:${value.execId}`
        : undefined
  }
}

function documentRequest<T extends DocMutateRequest>(
  args: unknown[],
  store: WebStore,
  user: string
): { externalConnectionId: string; request: T } {
  const value = objectArg(args, 0)
  const connectionId = String(value.connectionId ?? '')
  if (
    !connectionId ||
    typeof value.database !== 'string' ||
    !value.database ||
    typeof value.collection !== 'string' ||
    !value.collection ||
    !('id' in value)
  ) {
    throw new Error('Invalid document request.')
  }
  return {
    externalConnectionId: connectionId,
    request: {
      ...value,
      connectionId: store.sessionId(user, connectionId)
    } as unknown as T
  }
}

async function dispatch(
  store: WebStore,
  sessions: SessionManager,
  user: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  switch (method) {
    case 'connections.list':
      return store.listConnections(user)
    case 'connections.save':
      return store.saveConnection(user, connectionInput(args))
    case 'connections.delete': {
      const id = stringArg(args, 0)
      await sessions.disconnect(store.sessionId(user, id))
      store.deleteConnection(user, id)
      return
    }
    case 'connections.test':
      return sessions.test(store.decryptedInput(user, connectionInput(args)))
    case 'connections.buildUri':
      return store.buildConnectionUri(user, connectionInput(args), objectArg(args, 1).includePassword === true)
    case 'session.connect': {
      const id = stringArg(args, 0)
      const status = await sessions.connect(store.sessionId(user, id))
      return { ...status, id }
    }
    case 'session.disconnect':
      return sessions.disconnect(store.sessionId(user, stringArg(args, 0)))
    case 'session.status': {
      const id = stringArg(args, 0)
      return { ...sessions.getStatus(store.sessionId(user, id)), id }
    }
    case 'catalog.databases':
      return listDatabases(store.sessionId(user, stringArg(args, 0)), sessions)
    case 'catalog.collections':
      return listCollections(store.sessionId(user, stringArg(args, 0)), stringArg(args, 1), sessions)
    case 'catalog.collectionCount':
      return estimateCollectionCount(
        store.sessionId(user, stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions
      )
    case 'catalog.indexes':
      return listIndexes(store.sessionId(user, stringArg(args, 0)), stringArg(args, 1), stringArg(args, 2), sessions)
    case 'catalog.users':
      return listUsers(store.sessionId(user, stringArg(args, 0)), stringArg(args, 1), sessions)
    case 'catalog.sampleFields':
      return sampleFields(store.sessionId(user, stringArg(args, 0)), stringArg(args, 1), stringArg(args, 2), sessions)
    case 'shell.execute': {
      const external = objectArg(args, 0)
      const request = shellRequest(args, store, user)
      let ok = false
      try {
        const result = await executeShell(request, sessions)
        ok = result.kind !== 'error'
        store.addHistory(user, {
          code: request.code,
          connectionId: String(external.connectionId),
          database: request.database,
          ok,
          summary: historySummary(result.kind, result.count, result.elapsedMs, result.errorName)
        })
        return result
      } finally {
        store.audit({
          user,
          action: 'shell',
          connectionId: String(external.connectionId),
          database: request.database,
          ok
        })
      }
    }
    case 'shell.abort':
      return abortShell(`${createHash('sha256').update(user).digest('hex')}:${stringArg(args, 0)}`)
    case 'queries.list':
      return store.listQueries(user)
    case 'queries.save': {
      const input = objectArg(args, 0) as unknown as SavedQueryInput
      if (typeof input.name !== 'string' || typeof input.code !== 'string') throw new Error('Invalid saved query.')
      if (input.connectionId) store.sessionId(user, input.connectionId)
      return store.saveQuery(user, input)
    }
    case 'queries.delete':
      return store.deleteQuery(user, stringArg(args, 0))
    case 'history.list':
      return store.listHistory(user)
    case 'history.clear':
      return store.clearHistory(user)
    case 'docs.update': {
      const { externalConnectionId, request } = documentRequest<DocUpdateRequest>(args, store, user)
      if (typeof request.documentEjson !== 'string') throw new Error('Invalid document update.')
      const result = await updateDocument(request, sessions)
      store.audit({
        user,
        action: 'doc:update',
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok
      })
      return result
    }
    case 'docs.setField': {
      const { externalConnectionId, request } = documentRequest<DocSetFieldRequest>(args, store, user)
      if (typeof request.path !== 'string' || typeof request.valueEjson !== 'string') {
        throw new Error('Invalid document field update.')
      }
      const result = await setDocumentField(request, sessions)
      store.audit({
        user,
        action: 'doc:setField',
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok
      })
      return result
    }
    case 'docs.delete': {
      const { externalConnectionId, request } = documentRequest<DocMutateRequest>(args, store, user)
      const result = await deleteDocument(request, sessions)
      store.audit({
        user,
        action: 'doc:delete',
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok
      })
      return result
    }
    case 'settings.get':
      return store.getSettings(user)
    case 'settings.update':
      return store.updateSettings(user, objectArg(args, 0) as Partial<AppSettings>)
    default:
      throw new Error('Unsupported RPC method.')
  }
}

function serveStatic(staticDir: string, req: IncomingMessage, res: ServerResponse): void {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const root = resolve(staticDir)
  let path = resolve(root, `.${pathname}`)
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    res.writeHead(404).end()
    return
  }
  if (!existsSync(path) || statSync(path).isDirectory()) path = resolve(root, 'index.html')
  if (!existsSync(path)) {
    res.writeHead(404).end()
    return
  }
  const data = readFileSync(path)
  res.writeHead(200, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'content-length': data.length,
    'cache-control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-security-policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  })
  res.end(data)
}

export function createWebRequestHandler({ store, origin, staticDir }: WebServerOptions) {
  const sessions = new SessionManager(store)
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (req.method !== 'POST' || req.url !== '/api/rpc') {
      if (req.method === 'GET' || req.method === 'HEAD') serveStatic(staticDir, req, res)
      else sendJson(res, 404, { ok: false, error: 'Not found.' })
      return
    }

    try {
      if (req.headers.origin !== origin) throw new Error('Invalid request origin.')
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        throw new Error('Content-Type must be application/json.')
      }
      const user = userFrom(req)
      const body = await readBody(req)
      const result = await dispatch(store, sessions, user, body.method, body.args)
      sendJson(res, 200, { ok: true, result })
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { handle, closeSessions: () => sessions.closeAll() }
}

export function createWebServer(options: WebServerOptions) {
  const app = createWebRequestHandler(options)
  return { server: createServer(app.handle), closeSessions: app.closeSessions }
}
