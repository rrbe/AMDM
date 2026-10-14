import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import {
  assertRuntimeHealthy,
  DebuggerClient,
  launchPackaged,
  packagedExecutable,
  quitPackaged,
  waitForTarget,
  waitForUi,
} from '../test/helpers/packagedElectron.mjs'
import { environmentMetadata, statistics, writeReport } from './report.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '10' },
    'warm-queries': { type: 'string', default: '5' },
    app: { type: 'string' },
    output: { type: 'string', default: 'dist/benchmarks/runtime' },
  },
})
const iterations = Number(values.iterations),
  warmQueries = Number(values['warm-queries'])
for (const [name, count] of [
  ['iterations', iterations],
  ['warm-queries', warmQueries],
]) {
  assert.ok(
    Number.isInteger(count) && count >= 1 && count <= 50,
    `--${name} must be between 1 and 50`,
  )
}
const executable = values.app ? resolve(values.app) : packagedExecutable(root)
const output = resolve(root, values.output)
await mkdir(output, { recursive: true })
const metadata = { ...environmentMetadata(root), executable, iterations, warmQueries }
await writeReport(
  output,
  { status: 'running', metadata, samples: [] },
  '# Runtime benchmark in progress\n',
)
// Identify the measured artifact even when --app points at another checkout.
const resources =
  process.platform === 'darwin'
    ? join(dirname(executable), '..', 'Resources')
    : join(dirname(executable), 'resources')
metadata.artifactSha256 = createHash('sha256')
  .update(await readFile(join(resources, 'app.asar')))
  .digest('hex')
const temporary = await mkdtemp(join(tmpdir(), 'amdm-benchmark-'))
const samples = []
let replicaSet, mongo

async function cacheFileCount(directory) {
  let count = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? await cacheFileCount(join(directory, entry.name)) : 1
  }
  return count
}

async function sampleLaunch(uri, phase, iteration) {
  const profile = join(temporary, 'profiles', `${phase}-${iteration}`)
  const cache = join(
    temporary,
    'compile-cache',
    phase === 'reused-cache' ? 'fresh-cache-0' : `${phase}-${iteration}`,
  )
  await mkdir(profile, { recursive: true })
  await mkdir(cache, { recursive: true })
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      version: 1,
      settings: { automaticUpdateChecks: false, language: 'en' },
    }),
  )
  const cacheCountBefore = await cacheFileCount(cache)
  if (phase === 'reused-cache')
    assert.ok(cacheCountBefore > 0, 'No persisted compile cache to reuse')
  else assert.equal(cacheCountBefore, 0)
  const application = await launchPackaged(root, profile, executable)
  const clients = []
  try {
    const renderer = await DebuggerClient.connect(
      (await waitForTarget(application.rendererPort, (target) => target.type === 'page'))
        .webSocketDebuggerUrl,
    )
    clients.push(renderer)
    await waitForUi(renderer)
    const startupMs = performance.now() - application.startedAt
    const main = await DebuggerClient.connect(
      (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl,
    )
    clients.push(main)
    await main.call('NodeWorker.enable', { waitForDebuggerOnStart: false })
    // Keep the production lazy-load boundary: do not enable cache for main at startup.
    await main.evaluate(`process.env.NODE_COMPILE_CACHE = ${JSON.stringify(cache)}`)
    const url = new URL(uri)
    const connection = {
      id: 'benchmark',
      name: 'Benchmark',
      useSrv: false,
      host: url.host,
      replicaSet: url.searchParams.get('replicaSet'),
      defaultDatabase: 'amdm_benchmark',
      auth: { type: 'none' },
      ssh: { enabled: false },
      tls: { enabled: false },
    }
    await renderer.evaluate(`window.api.connections.save(${JSON.stringify(connection)})`)
    await renderer.evaluate('window.api.session.connect("benchmark")')
    const request = {
      connectionId: 'benchmark',
      database: 'amdm_benchmark',
      code: 'db.items.find().sort({n:1})',
      pageSize: 50,
    }
    async function query() {
      const started = performance.now()
      const result = await renderer.evaluate(`window.api.shell.execute(${JSON.stringify(request)})`)
      const elapsedMs = performance.now() - started
      assert.equal(result.kind, 'documents', JSON.stringify(result))
      assert.equal(result.count, 50)
      assert.equal(result.truncated, true)
      assert.deepEqual(result.data[0].n, { $numberInt: '0' })
      assert.deepEqual(result.data[49].n, { $numberInt: '49' })
      return { elapsedMs, applicationElapsedMs: result.elapsedMs }
    }
    const first = await query(),
      subsequent = []
    for (let queryIndex = 0; queryIndex < warmQueries; queryIndex++) subsequent.push(await query())
    const workers = main.events
      .filter((event) => event.method === 'NodeWorker.attachedToWorker')
      .map((event) => event.params.workerInfo.url)
    assert.ok(
      workers.some((url) => url.includes('serializer.worker.js')),
      'Serializer worker missing',
    )
    const runtime = await main.evaluate(`(() => {
      const m = process.getBuiltinModule('module'); const directory = m.getCompileCacheDir();
      m.flushCompileCache();
      const app = m.createRequire(${JSON.stringify(join(root, 'package.json'))})('electron').app;
      return {directory, node:process.versions.node, electron:process.versions.electron, appVersion:app.getVersion()};
    })()`)
    assert.ok(runtime.directory, 'Compile cache was not enabled')
    const cacheRelative = relative(cache, runtime.directory)
    assert.ok(
      !isAbsolute(cacheRelative) && !cacheRelative.startsWith('..'),
      'Unexpected compile cache directory',
    )
    metadata.application = {
      node: runtime.node,
      electron: runtime.electron,
      version: runtime.appVersion,
    }
    assertRuntimeHealthy(clients, application)
    await renderer.evaluate('window.api.session.disconnect("benchmark")')
    await quitPackaged(application, main, clients)
    assert.ok((await cacheFileCount(cache)) > 0, 'Compile cache was not persisted')
    return {
      phase,
      iteration,
      startupMs,
      firstQueryMs: first.elapsedMs,
      first,
      subsequentQueryMs: statistics(subsequent.map((query) => query.elapsedMs)).median,
      subsequent,
      cacheCountBefore,
      workers,
    }
  } finally {
    for (const client of clients) client.close()
    await application.stop()
    await writeFile(join(output, `${phase}-${iteration}.log`), application.logs)
  }
}

try {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '8.2.1' },
    replSet: { count: 1 },
  })
  mongo = new MongoClient(replicaSet.getUri())
  await mongo.connect()
  metadata.mongoVersion = (await mongo.db('admin').command({ buildInfo: 1 })).version
  await mongo
    .db('amdm_benchmark')
    .collection('items')
    .insertMany(
      Array.from({ length: 200 }, (_, n) => ({
        n,
        nested: { tags: ['one', 'two'], value: n },
        ...Object.fromEntries(
          Array.from({ length: 40 }, (_, k) => [`field${k}`, `value-${n}-${k}`]),
        ),
      })),
    )
  await mongo.db('amdm_benchmark').collection('items').createIndex({ n: 1 })
  // Warm the newly packaged executable once; exclude this sample from statistics.
  const warmup = await sampleLaunch(replicaSet.getUri(), 'warmup', 0)
  for (const phase of ['fresh-cache', 'reused-cache']) {
    for (let iteration = 0; iteration < iterations; iteration++) {
      samples.push(await sampleLaunch(replicaSet.getUri(), phase, iteration))
      await writeFile(
        join(output, 'samples.json'),
        JSON.stringify({ metadata, warmup, samples }, null, 2),
      )
      const { startupMs, firstQueryMs, subsequentQueryMs } = samples.at(-1)
      console.log(JSON.stringify({ phase, iteration, startupMs, firstQueryMs, subsequentQueryMs }))
    }
  }
  const summary = {}
  const lines = [
    '| Cache | Metric | Median (ms) | p95 (ms) | Min–max (ms) |',
    '| --- | --- | ---: | ---: | ---: |',
  ]
  for (const phase of ['fresh-cache', 'reused-cache']) {
    const phaseSamples = samples.filter((sample) => sample.phase === phase)
    summary[phase] = {}
    for (const metric of ['startupMs', 'firstQueryMs', 'subsequentQueryMs']) {
      const stats = statistics(phaseSamples.map((sample) => sample[metric]))
      summary[phase][metric] = stats
      lines.push(
        `| ${phase} | ${metric} | ${stats.median.toFixed(2)} | ${stats.p95.toFixed(2)} | ${stats.min.toFixed(2)}–${stats.max.toFixed(2)} |`,
      )
    }
  }
  await writeReport(
    output,
    { status: 'passed', metadata, warmup, samples, summary },
    '# Packaged Electron runtime benchmark\n\n' +
      `Artifact SHA-256: ${metadata.artifactSha256}\n\n` +
      `Platform: ${metadata.platform} ${metadata.arch}; Electron: ${metadata.application.electron}; CPU: ${metadata.cpu}\n\n` +
      `${iterations} launches per cache phase, ${warmQueries} subsequent queries per launch; one unmeasured warm-up.\n\n` +
      lines.join('\n') +
      '\n\n' +
      'Startup ends when the initial Renderer UI and bridge are ready. Queries measure IPC completion, including lazy runtime load and serialization, with 50 wide/nested documents returned from a 200-document indexed collection. Subsequent-query statistics use the median within each launch. Fresh V8 compile cache does not mean a cold operating-system file cache. UI result rendering, memory, build and packaging are excluded. No absolute timing threshold is applied.\n',
  )
  console.log(`Report: ${join(output, 'report.md')}`)
} catch (error) {
  await writeReport(
    output,
    { status: 'failed', metadata, samples, error: error.stack },
    `# Runtime benchmark failed\n\n${error.message}\n`,
  )
  throw error
} finally {
  await mongo?.close()
  await replicaSet?.stop()
  await rm(temporary, { recursive: true, force: true })
}
