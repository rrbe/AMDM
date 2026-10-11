import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const root = resolve(import.meta.dirname, '..')
const diagnostics = join(root, 'dist', 'runtime-validation')
const archSuffix = process.arch === 'x64' ? '' : `-${process.arch}`
const executable = {
  darwin: join(root, 'dist', `mac${archSuffix}`, 'AMDM.app', 'Contents', 'MacOS', 'AMDM'),
  win32: join(root, 'dist', `win${archSuffix}-unpacked`, 'AMDM.exe'),
  linux: join(root, 'dist', `linux${archSuffix}-unpacked`, 'amdm')
}[process.platform]
assert.ok(executable, `Unsupported platform: ${process.platform}`)
assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).type, 'module')
await mkdir(diagnostics, { recursive: true })

class DebuggerClient {
  sequence = 0
  pending = new Map()
  events = []

  static async connect(url) {
    const client = new DebuggerClient()
    client.socket = new WebSocket(url)
    await once(client.socket, 'open', { signal: AbortSignal.timeout(10_000) })
    client.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) {
        client.events.push(message)
        return
      }
      const pending = client.pending.get(message.id)
      if (!pending) return
      client.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
    await client.call('Runtime.enable')
    return client
  }

  call(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Debugger timeout: ${method}`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  close() {
    this.socket.close()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Debugger closed'))
    }
    this.pending.clear()
  }
}

async function waitForTarget(port, predicate) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    let targets
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000)
      })
      targets = await response.json()
    } catch {
      // Electron's debugger is not listening yet during application startup.
    }
    const target = targets?.find(predicate)
    if (target) return target
    await delay(100)
  }
  throw new Error(`Electron debugger target missing on port ${port}`)
}

const profile = await mkdtemp(join(tmpdir(), 'amdm-esm-ci-'))
let replicaSet, mongo, application, exit
const debuggers = []
let logs = ''
const report = { platform: process.platform, arch: process.arch }
try {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  mongo = new MongoClient(replicaSet.getUri())
  await mongo.connect()
  await mongo.db('esm_ci').collection('items').insertMany(
    Array.from({ length: 5 }, (_, n) => ({ n, nested: { tags: ['esm', 'bson'] } }))
  )
  const environment = { ...process.env }
  // On Windows, even an empty variable switches Electron into Node mode.
  delete environment.ELECTRON_RUN_AS_NODE
  application = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=9336', '--inspect=9337',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
  ], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  exit = new Promise(resolve => {
    application.once('exit', resolve)
    application.once('error', resolve)
  })
  application.stdout.on('data', data => { logs += data })
  application.stderr.on('data', data => { logs += data })
  application.on('error', error => { logs += `${error.stack}\n` })

  const renderer = await DebuggerClient.connect(
    (await waitForTarget(9336, target => target.type === 'page')).webSocketDebuggerUrl
  )
  debuggers.push(renderer)
  const main = await DebuggerClient.connect(
    (await waitForTarget(9337, () => true)).webSocketDebuggerUrl
  )
  debuggers.push(main)
  await main.call('NodeWorker.enable', { waitForDebuggerOnStart: false })
  await main.call('Profiler.enable')
  await main.call('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  await renderer.evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    function check() {
      if (window.api && document.querySelector('button')) resolve(true);
      else if (Date.now() > deadline) reject(new Error('Renderer bridge not ready'));
      else setTimeout(check, 50);
    }
    check();
  })`)
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
  const request = code => ({ connectionId: 'esm-ci', database: 'esm_ci', code, limit: 2 })
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
    (await waitForTarget(9336, target => target.url.includes('#settings'))).webSocketDebuggerUrl
  )
  debuggers.push(settings)
  assert.equal(await settings.evaluate('typeof window.api'), 'object')
  const preferences = await settings.evaluate('window.api.settings.get()')
  assert.ok(preferences && typeof preferences === 'object')
  report.settingsWindow = true
  report.exceptions = debuggers.flatMap(client => client.events)
    .filter(event => event.method === 'Runtime.exceptionThrown')
  assert.deepEqual(report.exceptions, [])
  assert.doesNotMatch(logs, /App threw an error|failed to load updater|failed to start updater|native addon not found/)
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const client of debuggers) client.close()
  if (application && application.exitCode === null && application.signalCode === null) {
    application.kill('SIGTERM')
    await exit
  }
  await writeFile(join(diagnostics, 'electron.log'), logs)
  await writeFile(join(diagnostics, 'report.json'), JSON.stringify(report, null, 2))
  await mongo?.close()
  await replicaSet?.stop()
  await rm(profile, { recursive: true, force: true })
}
