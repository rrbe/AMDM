import type { ShellRequest, ShellResult, ShellRuntime } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { legacyShellBackend, mongoshShellBackend } from './shellBackends'
import { prepareMongoshRuntime } from './mongoshCore'

/**
 * In-flight runs keyed by `execId`, so a slow find/aggregate can be cancelled
 * from the UI (the shell stays deliberately minimal; this is the one
 * piece of run lifecycle the session layer owns). The map only holds runs that
 * carried an `execId`; entries are removed in `finally` regardless of outcome.
 */
const inFlight = new Map<string, AbortController>()

export function prepareShellRuntime(runtime: ShellRuntime): void {
  if (runtime === 'mongosh') prepareMongoshRuntime()
}

/** Error used as the abort reason; the driver throws this from cancelled ops. */
class ShellAbortError extends Error {
  constructor() {
    super('执行已停止')
    this.name = 'Aborted'
  }
}

/**
 * Resolve the live MongoClient for this connection and route the user's shell
 * snippet to the runtime selected by the query tab. Backend implementations
 * have no Electron/session dependencies and remain independently testable.
 *
 * When `req.execId` is set we register an AbortController for the run so
 * {@link abortShell} can cancel it; the controller's signal is threaded into the
 * driver operations (find/aggregate/command) for true server-side cancellation.
 *
 * `getClient` may throw if the connection isn't open; that propagates as a
 * rejected IPC call (the renderer store surfaces it), matching prior behavior.
 */
export async function executeShell(req: ShellRequest): Promise<ShellResult> {
  const client = sessionManager.getClient(req.connectionId)
  const controller = req.execId ? new AbortController() : undefined
  if (req.execId && controller) inFlight.set(req.execId, controller)
  try {
    const backend = req.runtime === 'mongosh' ? mongoshShellBackend : legacyShellBackend
    return await backend.execute(client, req, controller?.signal)
  } finally {
    if (req.execId) inFlight.delete(req.execId)
  }
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
