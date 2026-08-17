import type {
  DocMutateRequest,
  DocMutateResult,
  DocReadRequest,
  DocReadResult,
  DocSetFieldRequest,
  DocUpdateRequest
} from '../../shared/types'
import type { WebContents } from 'electron'
import { sessionManager } from './sessionManager'
import { replaceDocumentOnDb, setFieldOnDb, deleteDocumentOnDb, readDocumentOnDb } from './docOpsCore'
import { serializerPool } from '../workers/serializerPool'

interface DocumentReadTask {
  controller: AbortController
}

const documentReadTasks = new Map<string, DocumentReadTask>()

function readTaskKey(taskId: string, ownerId: number): string {
  return `${ownerId}:${taskId}`
}

function abortError(): Error {
  const error = new Error('Document refresh cancelled')
  error.name = 'AbortError'
  return error
}

/**
 * Thin session wrappers: resolve the active client's `Db` and delegate to the
 * driver-only core (docOpsCore.ts), where the actual logic lives and is tested.
 * A failure to resolve the client (not connected) surfaces as an error result.
 */
function dbFor(connectionId: string, database: string) {
  return sessionManager.getClient(connectionId).db(database)
}

export async function readDocument(
  req: DocReadRequest,
  timeoutMS: number,
  owner: WebContents
): Promise<DocReadResult> {
  if (!req.taskId) return { ok: false, found: false, error: 'Missing document refresh task id.' }
  const key = readTaskKey(req.taskId, owner.id)
  const controller = new AbortController()
  documentReadTasks.get(key)?.controller.abort(abortError())
  documentReadTasks.set(key, { controller })
  const close = (): void => controller.abort(abortError())
  owner.once('destroyed', close)
  try {
    const document = await readDocumentOnDb(dbFor(req.connectionId, req.database), req.collection, req.id, {
      signal: controller.signal,
      timeoutMS
    })
    if (document === null) return { ok: true, found: false }
    return { ok: true, found: true, document: await serializerPool.serializeOne(document) }
  } catch (e) {
    return { ok: false, found: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    owner.removeListener('destroyed', close)
    if (documentReadTasks.get(key)?.controller === controller) documentReadTasks.delete(key)
  }
}

/** Cancel only a document refresh owned by the requesting Renderer. */
export function cancelDocumentRead(taskId: string, ownerId: number): boolean {
  const task = documentReadTasks.get(readTaskKey(taskId, ownerId))
  if (!task) return false
  task.controller.abort(abortError())
  return true
}

export async function updateDocument(req: DocUpdateRequest): Promise<DocMutateResult> {
  try {
    return await replaceDocumentOnDb(dbFor(req.connectionId, req.database), req.collection, req.id, req.documentEjson)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setDocumentField(req: DocSetFieldRequest): Promise<DocMutateResult> {
  try {
    return await setFieldOnDb(dbFor(req.connectionId, req.database), req.collection, req.id, req.path, req.valueEjson)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deleteDocument(req: DocMutateRequest): Promise<DocMutateResult> {
  try {
    return await deleteDocumentOnDb(dbFor(req.connectionId, req.database), req.collection, req.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
