import type { ShellRequest, ShellResult } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { runShellOnDb } from './shellCore'

/**
 * Resolve the live MongoClient for this connection and run the user's shell
 * snippet against the chosen database. All the shell-on-driver logic lives in
 * {@link runShellOnDb} (shellCore.ts), which has no Electron/session deps so it
 * stays unit-testable against a real `Db`.
 *
 * `getClient` may throw if the connection isn't open; that propagates as a
 * rejected IPC call (the renderer store surfaces it), matching prior behavior.
 */
export async function executeShell(req: ShellRequest): Promise<ShellResult> {
  const client = sessionManager.getClient(req.connectionId)
  const db = client.db(req.database)
  return runShellOnDb(db, req.code, { limit: req.limit, skip: req.skip, explain: req.explain })
}
