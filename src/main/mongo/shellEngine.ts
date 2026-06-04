import type { ShellRequest, ShellResult } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { runShellOnDb } from './shellCore'

/**
 * In-flight runs keyed by `execId`, so a slow find/aggregate can be cancelled
 * from the UI (ADR-0003 leaves the shell deliberately minimal; this is the one
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
 * Resolve the live MongoClient for this connection and run the user's shell
 * snippet against the chosen database. All the shell-on-driver logic lives in
 * {@link runShellOnDb} (shellCore.ts), which has no Electron/session deps so it
 * stays unit-testable against a real `Db`.
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
  const db = client.db(req.database)
  const controller = req.execId ? new AbortController() : undefined
  if (req.execId && controller) inFlight.set(req.execId, controller)
  try {
    return await runShellOnDb(db, req.code, {
      limit: req.limit,
      skip: req.skip,
      explain: req.explain,
      signal: controller?.signal
    })
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
