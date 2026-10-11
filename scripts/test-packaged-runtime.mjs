import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import {
  assertRuntimeHealthy, DebuggerClient, launchPackaged, waitForTarget, waitForUi
} from '../test/helpers/packagedElectron.mjs'

const root = resolve(import.meta.dirname, '..')
const diagnostics = join(root, 'dist', 'runtime-validation')
assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).type, 'module')
await mkdir(diagnostics, { recursive: true })

const profile = await mkdtemp(join(tmpdir(), 'amdm-esm-ci-'))
let replicaSet, mongo, application
const debuggers = []
const report = { platform: process.platform, arch: process.arch }
try {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  mongo = new MongoClient(replicaSet.getUri())
  await mongo.connect()
  await mongo.db('esm_ci').collection('items').insertMany(
    Array.from({ length: 5 }, (_, n) => ({ n, nested: { tags: ['esm', 'bson'] } }))
  )
  application = await launchPackaged(root, profile)

  const renderer = await DebuggerClient.connect(
    (await waitForTarget(application.rendererPort, target => target.type === 'page')).webSocketDebuggerUrl
  )
  debuggers.push(renderer)
  const main = await DebuggerClient.connect(
    (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl
  )
  debuggers.push(main)
  await main.call('NodeWorker.enable', { waitForDebuggerOnStart: false })
  await main.call('Profiler.enable')
  await main.call('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  await waitForUi(renderer)
  report.mainWindow = await renderer.evaluate(`({
    apiKeys: Object.keys(window.api), nodeAccess: typeof window.require,
    rootDisplay: getComputedStyle(document.getElementById('root')).display
  })`)
  assert.equal(report.mainWindow.nodeAccess, 'undefined')
  assert.notEqual(report.mainWindow.rootDisplay, 'none')
  report.updates = await renderer.evaluate('window.api.updates.getState()')
  assert.equal(report.updates.available, process.platform !== 'linux')
  await renderer.evaluate('window.api.updates.setAutomaticChecks(false)')

  const uri = new URL(replicaSet.getUri())
  const connection = {
    id: 'esm-ci', name: 'ESM CI', useSrv: false, host: uri.host,
    replicaSet: uri.searchParams.get('replicaSet'), defaultDatabase: 'esm_ci',
    auth: { type: 'none' }, ssh: { enabled: false }, tls: { enabled: false }
  }
  await renderer.evaluate(`window.api.connections.save(${JSON.stringify(connection)})`)
  await renderer.evaluate('window.api.session.connect("esm-ci")')
  const request = code => ({ connectionId: 'esm-ci', database: 'esm_ci', code, pageSize: 2 })
  const run = code => renderer.evaluate(`window.api.shell.execute(${JSON.stringify(request(code))})`)
  // These are the first Shell calls: both await the same lazy ESM runtime load.
  const first = await renderer.evaluate(`Promise.all([
    window.api.shell.execute(${JSON.stringify(request('db.items.find().sort({n:1})'))}),
    window.api.shell.execute(${JSON.stringify(request('db.items.countDocuments()'))})
  ])`)
  assert.equal(first[0].kind, 'documents', JSON.stringify(first))
  assert.equal(first[0].count, 2)
  assert.equal(first[0].truncated, true)
  assert.deepEqual(first[0].data[0].n, { $numberInt: '0' })
  assert.deepEqual(first[1].data, { $numberInt: '5' })
  report.concurrentFirstQueries = first.map(result => result.kind)
  const transaction = await run(`const s=db.getMongo().startSession();
    try { s.withTransaction(() => {
      s.getDatabase(db.getName()).items.updateOne({n:0}, {$set:{committed:true}})
    }) } finally { s.endSession() }
    db.items.findOne({n:0}).committed`)
  assert.equal(transaction.kind, 'value', JSON.stringify(transaction))
  assert.equal(transaction.data, true)
  assert.equal((await mongo.db('esm_ci').collection('items').findOne({ n: 0 })).committed, true)
  report.transaction = true
  report.workers = main.events.filter(event => event.method === 'NodeWorker.attachedToWorker')
    .map(event => event.params.workerInfo.url)
  assert.ok(report.workers.some(url => url.includes('serializer.worker.js')), 'Serializer worker did not start')
  const coverage = await main.call('Profiler.takePreciseCoverage')
  await main.call('Profiler.stopPreciseCoverage')
  const mainScript = coverage.result.find(script => script.url.endsWith('/out/main/index.js'))
  assert.ok(mainScript, 'Main process coverage missing')
  const mainSource = await readFile(join(root, 'out/main/index.js'), 'utf8')
  report.mainSerializerCalls = mainScript.functions
    .filter(fn => fn.functionName === 'serialize' && mainSource
      .slice(fn.ranges[0].startOffset, fn.ranges[0].endOffset).includes('values.map(serializeValue)'))
    .reduce((count, fn) => count + fn.ranges[0].count, 0)
  assert.ok(report.mainSerializerCalls > 0, 'Serializer pool was not exercised')
  // Precise coverage omits scripts with no calls after recording starts.
  const serializerCore = coverage.result.find(script => script.url.includes('/chunks/schema-analysis-core-'))
  report.inlineSerializationCalls = (serializerCore?.functions ?? [])
    .filter(fn => fn.functionName === 'serializeValue')
    .reduce((count, fn) => count + fn.ranges[0].count, 0)
  assert.equal(report.inlineSerializationCalls, 0, 'Serialization fell back to the main process')

  await renderer.evaluate('window.api.app.openSettings()')
  const settings = await DebuggerClient.connect(
    (await waitForTarget(application.rendererPort, target => target.url.includes('#settings'))).webSocketDebuggerUrl
  )
  debuggers.push(settings)
  assert.equal(await settings.evaluate('typeof window.api'), 'object')
  const preferences = await settings.evaluate('window.api.settings.get()')
  assert.ok(preferences && typeof preferences === 'object')
  report.settingsWindow = true
  report.exceptions = debuggers.flatMap(client => client.events)
    .filter(event => event.method === 'Runtime.exceptionThrown')
  assert.deepEqual(report.exceptions, [])
  assertRuntimeHealthy(debuggers, application)
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const client of debuggers) client.close()
  await application?.stop()
  await writeFile(join(diagnostics, 'electron.log'), application?.logs ?? '')
  await writeFile(join(diagnostics, 'report.json'), JSON.stringify(report, null, 2))
  await mongo?.close()
  await replicaSet?.stop()
  await rm(profile, { recursive: true, force: true })
}
