import type { ShellPageRequest, ShellRequest, ShellResult, ShellResultTotal } from '../../shared/types'
import type { SessionManager } from './sessionManager'
import { runMongoshOnClient } from './mongoshCore'
import { shellResults } from './shellResults'
import { classifyOperationFailure } from './errorCore'

/**
 * In-flight runs keyed by `execId`, so a slow find/aggregate can be cancelled
 * from the UI (the shell stays deliberately minimal; this is the one
 * piece of run lifecycle the session layer owns). The map only holds runs that
 * carried an `execId`; entries are removed in `finally` regardless of outcome.
 */
const inFlight = new Map<string, AbortController>()

/** Error used as the abort reason; the driver throws this from cancelled ops. */
class ShellAbortError extends Error {
  constructor() {
    super('执行已停止')
    this.name = 'Aborted'
  }
}

/**
 * Resolve the live MongoClient for this connection and route the user's shell
 * snippet to Mongosh. The evaluator has no Electron/session dependencies.
 *
 * When `req.execId` is set we register an AbortController for the run so
 * {@link abortShell} can cancel it; the controller's signal is threaded into the
 * driver operations (find/aggregate/command) for true server-side cancellation.
 *
 * `getClient` may throw if the connection isn't open; that propagates as a
 * rejected IPC call (the renderer store surfaces it), matching prior behavior.
 */
export async function executeShell(req: ShellRequest, ownerId: number | string, sessions: SessionManager): Promise<ShellResult> {
  const client = sessions.getClient(req.connectionId)
  const pageSize = validatePageSize(req.pageSize ?? 50)
  const controller = new AbortController()
  const session = shellResults.create(req.connectionId, ownerId, controller, req.timeoutMS ?? 30_000)
  if (req.execId) inFlight.set(req.execId, controller)
  try {
    const result = await runMongoshOnClient(client, req.code, {
      database: req.database,
      limit: pageSize,
      explain: req.explain,
      timeoutMS: req.timeoutMS,
      signal: controller.signal,
      resultSession: session
    })
    if (!result.resultId) await shellResults.release(session.id, ownerId)
    return result
  } catch (error) {
    await shellResults.release(session.id, ownerId)
    throw error
  } finally {
    if (req.execId) inFlight.delete(req.execId)
  }
}

function validatePageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 2000) throw new Error('Invalid page size')
  return pageSize
}

export async function readShellPage(req: ShellPageRequest, ownerId: number | string): Promise<ShellResult> {
  const pageSize = validatePageSize(req.pageSize)
  if (!Number.isSafeInteger(req.skip) || req.skip < 0) throw new Error('Invalid page offset')
  const session = shellResults.get(req.resultId, ownerId)
  inFlight.set(req.execId, session.controller)
  try {
    return await session.page(req.skip, pageSize)
  } catch (error) {
    return {
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Error',
      failureKind: session.controller.signal.reason instanceof ShellAbortError
        ? 'cancelled'
        : classifyOperationFailure(error)
    }
  } finally {
    inFlight.delete(req.execId)
  }
}

export async function readShellTotal(resultId: string, ownerId: number | string): Promise<ShellResultTotal> {
  return shellResults.get(resultId, ownerId).getTotal()
}

export function releaseShellResult(resultId: string, ownerId: number | string): Promise<void> {
  return shellResults.release(resultId, ownerId)
}

/**
 * Cancel an in-flight run. Returns true if a matching run was found and
 * signalled, false if it had already finished (a benign race the UI ignores).
 */
export function abortShell(execId: string): boolean {
  const controller = inFlight.get(execId)
  if (!controller) return false
  controller.abort(new ShellAbortError())
  return true
}
