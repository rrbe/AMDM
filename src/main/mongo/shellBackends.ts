import type { MongoClient } from 'mongodb'
import type { ShellRequest, ShellResult } from '../../shared/types'
import { runMongoshOnClient } from './mongoshCore'
import { runShellOnDb } from './shellCore'

export interface ShellBackend {
  execute(client: MongoClient, request: ShellRequest, signal?: AbortSignal): Promise<ShellResult>
}

export const legacyShellBackend: ShellBackend = {
  execute(client, request, signal) {
    return runShellOnDb(client.db(request.database), request.code, {
      limit: request.limit,
      skip: request.skip,
      explain: request.explain,
      timeoutMS: request.timeoutMS,
      signal
    })
  }
}

export const mongoshShellBackend: ShellBackend = {
  execute(client, request, signal) {
    return runMongoshOnClient(client, request.code, {
      database: request.database,
      limit: request.limit,
      skip: request.skip,
      explain: request.explain,
      timeoutMS: request.timeoutMS,
      signal
    })
  }
}
