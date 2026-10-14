import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { environmentMetadata, statistics, writeReport } from './report.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '5' },
    output: { type: 'string', default: 'dist/benchmarks/build' },
  },
})
const iterations = Number(values.iterations)
assert.ok(
  Number.isInteger(iterations) && iterations >= 1 && iterations <= 50,
  '--iterations must be between 1 and 50',
)
assert.ok(process.env.npm_execpath, 'Run this script with pnpm bench:build')
const output = resolve(root, values.output)
await mkdir(output, { recursive: true })
const samples = []
const metadata = environmentMetadata(root)
await writeReport(
  output,
  { status: 'running', metadata, iterations, samples },
  '# Build benchmark in progress\n',
)
for (let iteration = 0; iteration < iterations; iteration++) {
  const started = performance.now()
  const child = spawn(process.execPath, [process.env.npm_execpath, 'build'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    killSignal: 'SIGKILL',
  })
  let logs = ''
  child.stdout.on('data', (data) => {
    logs += data
  })
  child.stderr.on('data', (data) => {
    logs += data
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  const elapsedMs = performance.now() - started
  await writeFile(join(output, `build-${iteration}.log`), logs)
  assert.equal(code, 0, `Build failed; see ${join(output, `build-${iteration}.log`)}`)
  samples.push({ iteration, elapsedMs })
  console.log(JSON.stringify(samples.at(-1)))
}
const sizes = {}
for (const directory of ['main', 'preload', 'renderer/assets']) {
  for (const name of await readdir(join(root, 'out', directory))) {
    const path = join(root, 'out', directory, name)
    const info = await stat(path)
    if (info.isFile() && /\.(?:[cm]?js|css)$/.test(name)) sizes[`${directory}/${name}`] = info.size
  }
}
const summary = statistics(samples.map((sample) => sample.elapsedMs))
await writeReport(
  output,
  { status: 'passed', metadata, iterations, samples, summary, outputFileBytes: sizes },
  `# Production build benchmark\n\nCommit: ${metadata.sourceCommit}${metadata.sourceDirty ? ' (working tree modified)' : ''}\n\n` +
    `Platform: ${metadata.platform} ${metadata.arch}; Node: ${metadata.runnerNode}; CPU: ${metadata.cpu}\n\n` +
    `Runs: ${iterations}; median: ${summary.median.toFixed(1)} ms; p95: ${summary.p95.toFixed(1)} ms; range: ${summary.min.toFixed(1)}–${summary.max.toFixed(1)} ms.\n\n` +
    'Measures the complete `pnpm build` command, including command startup. Repeated runs reuse operating-system and tool caches. Packaging and installer compression are excluded. Raw samples and output file sizes are in report.json.\n',
)
console.log(`Report: ${join(output, 'report.md')}`)
