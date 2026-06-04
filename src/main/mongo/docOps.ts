import type {
  DocMutateRequest,
  DocMutateResult,
  DocSetFieldRequest,
  DocUpdateRequest
} from '../../shared/types'
import { sessionManager } from './sessionManager'
import { replaceDocumentOnDb, setFieldOnDb, deleteDocumentOnDb } from './docOpsCore'

/**
 * Thin session wrappers: resolve the active client's `Db` and delegate to the
 * driver-only core (docOpsCore.ts), where the actual logic lives and is tested.
 * A failure to resolve the client (not connected) surfaces as an error result.
 */
function dbFor(connectionId: string, database: string) {
  return sessionManager.getClient(connectionId).db(database)
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
