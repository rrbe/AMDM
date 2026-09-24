import { existsSync } from 'node:fs'
import { enableCompileCache } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import type { ClientSession, MongoClient } from 'mongodb'
import { AbstractCursor, FindCursor } from 'mongodb'
import type { CompassServiceProvider, DevtoolsConnectOptions } from '@mongosh/service-provider-node-driver'
import type { ShellInstanceState, ShellResult as MongoshResult } from '@mongosh/shell-api'
import type { ShellEvaluator } from '@mongosh/shell-evaluator'
import type { ShellResult } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'
import { classifyOperationFailure } from './errorCore'
import { detectCollection, makeDriverDbProxy, OutputCollector, prepareTopLevelAwait, withAbort } from './shellSupport'

const DEFAULT_LIMIT = 50
const EXEC_TIMEOUT_MS = 30_000

interface MongoshRuntime {
  CompassServiceProvider: typeof CompassServiceProvider
  ShellEvaluator: typeof ShellEvaluator
  ShellInstanceState: typeof ShellInstanceState
  getShellApiType(value: unknown): string | null
  toShellResult(value: unknown): Promise<MongoshResult>
}

let loadedRuntime: MongoshRuntime | undefined
const providerCleanup = new WeakMap<CompassServiceProvider, () => void>()

function loadMongoshRuntime(): MongoshRuntime {
  if (loadedRuntime) return loadedRuntime
  const packagedPath = join(__dirname, 'mongosh-runtime.cjs')
  const developmentPath = join(process.cwd(), 'out', 'main', 'mongosh-runtime.cjs')
  const runtimePath = existsSync(packagedPath) ? packagedPath : developmentPath
  // Persist V8's compiled form after the first load so later app launches do
  // not repeatedly parse the large generated CommonJS runtime.
  enableCompileCache()
  loadedRuntime = require(runtimePath) as MongoshRuntime
  return loadedRuntime
}

export function createMongoshServiceProvider(client: MongoClient): CompassServiceProvider {
  const { CompassServiceProvider } = loadMongoshRuntime()
  const event = 'topologyDescriptionChanged'
  const listenersBefore = new Set(client.listeners(event))
  const provider = new CompassServiceProvider(
    client,
    new EventEmitter(),
    client.options as unknown as DevtoolsConnectOptions
  )
  const addedListeners = client.listeners(event).filter((listener) => !listenersBefore.has(listener))
  providerCleanup.set(provider, () => {
    for (const listener of addedListeners) client.removeListener(event, listener)
  })
  return provider
}

function releaseMongoshServiceProvider(provider: CompassServiceProvider): void {
  providerCleanup.get(provider)?.()
  providerCleanup.delete(provider)
}

function trackExecutionSessions(provider: CompassServiceProvider): () => Promise<void> {
  const sessions = new Set<ClientSession>()
  const startSession = provider.startSession.bind(provider)
  provider.startSession = ((options) => {
    const session = startSession(options)
    sessions.add(session)
    return session
  }) as CompassServiceProvider['startSession']
  return async () => {
    await Promise.allSettled([...sessions].map((session) => session.endSession()))
    sessions.clear()
  }
}

export interface MongoshEvaluationOptions {
  limit?: number
  skip?: number
  explain?: boolean
  timeoutMS?: number
  signal?: AbortSignal
  output?: OutputCollector
}

export interface MongoshEvaluation {
  result: MongoshResult
  database: string
}

export async function evaluateMongosh(
  provider: CompassServiceProvider,
  database: string,
  code: string,
  options: MongoshEvaluationOptions = {}
): Promise<MongoshEvaluation> {
  const runtime = loadMongoshRuntime()
  // AMDM renders results itself, so mongosh's deep-inspection wrappers only
  // add per-execution proxy/closure allocation without affecting output.
  const state = new runtime.ShellInstanceState(provider, undefined, {
    deepInspect: false
  })
  state.setPreFetchCollectionAndDatabaseNames(false)
  state.displayBatchSizeFromDBQuery = options.limit ?? DEFAULT_LIMIT
  state.currentDb = state.currentDb.getMongo().getDB(database)
  provider.baseCmdOptions = {
    ...provider.baseCmdOptions,
    ...(options.timeoutMS ? { maxTimeMS: options.timeoutMS } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  }

  const context = vm.createContext({})
  const contextObject = vm.runInContext('globalThis', context) as Record<string, unknown>
  if (options.output) {
    state.setEvaluationListener({
      onPrint(values, type) {
        options.output?.push(
          type,
          values.map((value) => value.printable)
        )
      }
    })
  }
  state.setCtx(contextObject)
  Object.defineProperty(contextObject, 'driverDb', {
    configurable: true,
    enumerable: true,
    get: () =>
      makeDriverDbProxy(provider.mongoClient.db(state.currentDb.getName()), options.signal, options.timeoutMS)
  })
  if (options.output) {
    const print = (...values: unknown[]): void => options.output?.push('print', values)
    contextObject.console = {
      log: print,
      info: print,
      warn: (...values: unknown[]) => options.output?.push('print', values, 'warn'),
      error: (...values: unknown[]) => options.output?.push('print', values, 'error')
    }
  }

  const evaluator = new runtime.ShellEvaluator(state, async (value) => {
    const type = runtime.getShellApiType(value)
    if (options.explain) {
      if (!value || typeof (value as { explain?: unknown }).explain !== 'function') {
        throw new Error('Explain is only supported for find()/aggregate() queries.')
      }
      value = await (value as { explain(verbosity: string): Promise<unknown> }).explain('executionStats')
    } else if (value instanceof AbstractCursor) {
      const cursor = value
      try {
        if (options.skip && cursor instanceof FindCursor) cursor.skip(options.skip)
        const documents: unknown[] = []
        const limit = options.limit ?? DEFAULT_LIMIT
        while (documents.length < limit && (await cursor.hasNext())) {
          documents.push(await cursor.next())
        }
        return {
          type: cursor instanceof FindCursor ? 'Cursor' : 'DriverCursor',
          rawValue: cursor,
          printable: { documents, cursorHasMore: await cursor.hasNext() },
          ...(cursor.namespace.collection
            ? { source: { namespace: { db: cursor.namespace.db, collection: cursor.namespace.collection } } }
            : {})
        }
      } finally {
        await cursor.close()
      }
    } else if (options.skip && type === 'Cursor' && typeof (value as { skip?: unknown })?.skip === 'function') {
      const cursor = value as { skip(value: number): unknown }
      cursor.skip(options.skip)
    }
    return runtime.toShellResult(value)
  })
  const evaluate = async (input: string, _context: object, filename: string): Promise<unknown> => {
    const script = new vm.Script(input, { filename: filename || 'shell.js' })
    return script.runInContext(context, { timeout: EXEC_TIMEOUT_MS })
  }
  const onAbort = (): void => {
    void state.interrupted.set()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (options.signal?.aborted) await state.interrupted.set()
    const result = await evaluator.customEval(evaluate, prepareTopLevelAwait(code), contextObject, 'shell.js')
    return { result, database: state.currentDb.getName() }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

const WRITE_RESULT_TYPES = new Set([
  'BulkWriteResult',
  'ClientBulkWriteResult',
  'DeleteResult',
  'InsertManyResult',
  'InsertOneResult',
  'UpdateResult'
])

function describeError(error: unknown): { error: string; errorName: string } {
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    const value = error as { message?: unknown; name?: unknown }
    return {
      error: typeof value.message === 'string' ? value.message : String(error),
      errorName: typeof value.name === 'string' ? value.name : 'Error'
    }
  }
  return { error: String(error), errorName: 'Error' }
}

async function outputFields(output: OutputCollector): Promise<Pick<ShellResult, 'output' | 'outputTruncated'>> {
  if (output.size === 0) return {}
  return {
    output: await output.toLines(),
    ...(output.truncated ? { outputTruncated: true } : {})
  }
}

async function adaptMongoshResult(
  evaluation: MongoshEvaluation,
  code: string,
  options: MongoshEvaluationOptions & { database: string },
  started: number,
  output: OutputCollector
): Promise<ShellResult> {
  const { result } = evaluation
  const collection = result.source?.namespace.collection ?? detectCollection(code)
  const elapsedMs = Date.now() - started
  const common = { collection, elapsedMs, ...(await outputFields(output)) }

  if (options.explain) {
    return {
      kind: 'explain',
      data: await serializerPool.serializeOne(result.printable),
      ...common
    }
  }

  const cursor = result.printable as { documents?: unknown[]; cursorHasMore?: boolean } | undefined
  if (result.type?.endsWith('Cursor') && Array.isArray(cursor?.documents)) {
    return {
      kind: 'documents',
      data: await serializerPool.serialize(cursor.documents),
      count: cursor.documents.length,
      truncated: cursor.cursorHasMore === true,
      pageable: result.type === 'Cursor',
      skip: options.skip ?? 0,
      ...common
    }
  }

  if (Array.isArray(result.printable)) {
    return {
      kind: 'documents',
      data: await serializerPool.serialize(result.printable),
      count: result.printable.length,
      truncated: false,
      ...common
    }
  }

  if (result.type && WRITE_RESULT_TYPES.has(result.type)) {
    return {
      kind: 'ack',
      data: await serializerPool.serializeOne(result.printable),
      ...common
    }
  }

  return {
    kind: 'value',
    data: await serializerPool.serializeOne(result.printable ?? null),
    ...(evaluation.database !== options.database ? { useDatabase: evaluation.database } : {}),
    ...common
  }
}

export interface RunMongoshOptions extends MongoshEvaluationOptions {
  database: string
}

export async function runMongoshOnClient(
  client: MongoClient,
  code: string,
  options: RunMongoshOptions
): Promise<ShellResult> {
  const started = Date.now()
  const output = new OutputCollector()
  let provider: CompassServiceProvider | undefined
  let releaseSessions: (() => Promise<void>) | undefined
  try {
    provider = createMongoshServiceProvider(client)
    releaseSessions = trackExecutionSessions(provider)
    const evaluation = await evaluateMongosh(provider, options.database, code, { ...options, output })
    try {
      return await withAbort(adaptMongoshResult(evaluation, code, options, started, output), options.signal)
    } finally {
      const rawValue = evaluation.result.rawValue as { close?: () => Promise<void> } | undefined
      if (typeof rawValue?.close === 'function') await rawValue.close().catch(() => {})
    }
  } catch (error) {
    if (options.signal?.aborted) {
      return {
        kind: 'error',
        error: '执行已停止',
        errorName: 'Aborted',
        failureKind: 'cancelled',
        collection: detectCollection(code),
        elapsedMs: Date.now() - started,
        ...(await outputFields(output))
      }
    }
    const described = describeError(error)
    return {
      kind: 'error',
      ...described,
      failureKind: classifyOperationFailure(error),
      collection: detectCollection(code),
      elapsedMs: Date.now() - started,
      ...(await outputFields(output))
    }
  } finally {
    await releaseSessions?.()
    if (provider) releaseMongoshServiceProvider(provider)
  }
}
