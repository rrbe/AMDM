import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  assertRuntimeHealthy,
  clickElement,
  DebuggerClient,
  launchPackaged,
  packagedExecutable,
  quitPackaged,
  waitForExpression,
  waitForTarget,
  waitForUi
} from '../test/helpers/packagedElectron.mjs'
import {
  openQuickSearch,
  pressKey,
  primaryModifier,
  searchQuickly,
  selectSearchGroup,
  updateRendererSettings
} from '../test/helpers/quickSearch.mjs'

const root = resolve(import.meta.dirname, '..')
const argumentsList = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argumentsList.indexOf(name)
  return index < 0 ? fallback : argumentsList[index + 1]
}
const iterations = Number(option('--iterations', 25))
assert.ok(Number.isInteger(iterations) && iterations >= 5 && iterations <= 50)
const output = resolve(option('--output', join(root, 'dist/benchmarks/search')))
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'amdm-search-benchmark-'))
const codeLength = Math.ceil(20_000_000 / 2900)
const code = (kind, n) =>
  `db.search_bench_${kind}_${n}.find({}); /* ${'sample '.repeat(Math.ceil(codeLength / 7))} */`.slice(
    0,
    codeLength - 3
  ) + ' */'
const report = {
  timestamp: new Date().toISOString(),
  buildMode: 'packaged production',
  cacheState:
    'fresh search worker/index for every opening; retained OS file caches; workspace UI already loaded',
  repository: {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  },
  boundary:
    'Native Electron key/input event timestamp through completed UI paint; database and Shell timings excluded. Main IPC fixtures supply synthetic metadata and empty results; tabs are created through UI actions.',
  machine: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version },
  fixture: {
    catalogCollections: 10000,
    queryTabs: 100,
    dataTabs: 800,
    savedQueries: 1000,
    history: 1000,
    codeCharacters: codeLength * 2900
  },
  samples: []
}
const clients = []
let application, renderer
try {
  const connection = {
    id: 'bench',
    name: 'Search benchmark',
    host: '127.0.0.1',
    port: 27017,
    defaultDatabase: 'search_bench',
    auth: { type: 'none' },
    ssh: { enabled: false },
    tls: { enabled: false }
  }
  await writeFile(
    join(profile, 'connections.json'),
    JSON.stringify({ version: 1, connections: [connection] })
  )
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      version: 1,
      settings: { language: 'en', historyLimit: 1000, automaticUpdateChecks: false }
    })
  )
  await writeFile(
    join(profile, 'queries.json'),
    JSON.stringify({
      version: 1,
      queries: Array.from({ length: 1000 }, (_, n) => ({
        id: `s${n}`,
        name: `Saved search_bench ${n}`,
        code: code('saved', n),
        connectionId: 'bench',
        database: 'search_bench',
        createdAt: n,
        updatedAt: n
      })),
      history: Array.from({ length: 1000 }, (_, n) => ({
        id: `h${n}`,
        code: code('history', n),
        connectionId: 'bench',
        database: 'search_bench',
        ranAt: n,
        ok: true
      }))
    })
  )
  application = await launchPackaged(root, profile)
  renderer = await DebuggerClient.connect(
    (await waitForTarget(application.rendererPort, (target) => target.type === 'page')).webSocketDebuggerUrl
  )
  const main = await DebuggerClient.connect(
    (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl
  )
  clients.push(renderer, main)
  await waitForUi(renderer)
  report.viewport = await renderer.evaluate(
    '({ width: innerWidth, height: innerHeight, devicePixelRatio, theme: document.documentElement.dataset.theme })'
  )
  report.runtime = await main.evaluate(
    '({ electron: process.versions.electron, node: process.versions.node })'
  )
  const executable = packagedExecutable(root)
  const asar =
    process.platform === 'darwin'
      ? resolve(executable, '../../Resources/app.asar')
      : resolve(executable, '../resources/app.asar')
  report.appAsarSha256 = createHash('sha256')
    .update(await readFile(asar))
    .digest('hex')
  await main.evaluate(`(() => {
    const { ipcMain } = process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, 'package.json'))})('electron');
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
    replace('session:connect', () => ({ id: 'bench', state: 'connected' }));
    replace('catalog:databases', () => [{ name: 'search_bench' }]);
    replace('catalog:collections', () => Array.from({length:10000}, (_,n) => ({name:'search_bench_collection_'+n, type:'collection'})));
    replace('catalog:indexes', () => []);
    replace('catalog:collectionCount', () => 0);
    replace('catalog:sampleFields', () => []);
    replace('shell:execute', () => ({ kind: 'documents', data: [], count: 0, collection: 'search_bench_result', totalCount: 0, totalStatus: 'known', elapsedMs: 1 }));
    return true;
  })()`)
  await clickElement(renderer, 'document.querySelector(".conn-item")', 2)
  await waitForExpression(renderer, '!!document.querySelector(".conn-status[aria-label=Connected]")')
  await clickElement(renderer, 'document.querySelector(".tree-node")')
  await clickElement(
    renderer,
    '[...document.querySelectorAll(".tree-label")].find(label => label.textContent === "search_bench_collection_0")?.closest(".tree-node")',
    2
  )
  await waitForExpression(renderer, '!!document.querySelector(".result-total")')
  for (let n = 0; n < 100; n++) {
    if (n) await pressKey(renderer, 't', 'KeyT', 84, primaryModifier)
    await clickElement(renderer, 'document.querySelector(".cm-content[contenteditable=true]")')
    await pressKey(renderer, 'a', 'KeyA', 65, primaryModifier)
    await renderer.call('Input.insertText', { text: code('query', n) })
    const already = n ? 0 : 1
    for (let run = already; run < 8; run++) {
      await pressKey(renderer, 'Enter', 'Enter', 13, primaryModifier)
      await waitForExpression(
        renderer,
        `!!document.querySelector('.result-total') && document.querySelectorAll('.rtab').length === ${run ? run + 1 : 0} && !document.querySelector('.work-actions .animate-spin')`
      )
    }
    if (n % 20 === 0) console.log(`Prepared ${n + 1}/100 query tabs`)
  }
  assert.equal(await renderer.evaluate('document.querySelectorAll(".qtab").length'), 100)
  await renderer.evaluate(`window.searchMeasurements = { open: [], input: [], arrows: [], longTasks: [], mounted: [] };
    window.measuringSearch = true;
    new PerformanceObserver(list => { if(window.measuringSearch) for(const entry of list.getEntries()) searchMeasurements.longTasks.push({at:entry.startTime, duration:entry.duration}); }).observe({type:'longtask'});
    function painted(start, kind, query) {
      const list = document.querySelector('[data-quick-search] [role=listbox]');
      const ready = document.querySelector('[data-quick-search]') && document.activeElement?.getAttribute('role') === 'combobox' &&
        (kind !== 'input' || (list?.getAttribute('aria-busy') === 'false' && list.dataset.searchQuery === query));
      if(!ready) { requestAnimationFrame(() => painted(start,kind,query)); return; }
      requestAnimationFrame(() => {
        if(kind === 'input' && (list.getAttribute('aria-busy') !== 'false' || list.dataset.searchQuery !== query)) { painted(start,kind,query); return; }
        searchMeasurements[kind].push(performance.now()-start);
        searchMeasurements.mounted.push(document.querySelectorAll('[data-quick-search] [role=option]').length);
      });
    }
    window.addEventListener('keydown', event => {
      if(event.key === 'k' && (event.metaKey || event.ctrlKey)) requestAnimationFrame(() => painted(event.timeStamp,'open'));
      if(event.key === 'ArrowDown' && document.activeElement?.getAttribute('role') === 'combobox') requestAnimationFrame(() => painted(event.timeStamp,'arrows'));
    }, true);
    document.addEventListener('input', event => { if(event.target.closest('[data-quick-search]')) requestAnimationFrame(() => painted(event.timeStamp,'input',event.target.value)); }, true); true`)
  for (let n = 0; n < iterations; n++) {
    await openQuickSearch(renderer)
    await waitForExpression(renderer, `window.searchMeasurements.open.length === ${n + 1}`)
    await searchQuickly(
      renderer,
      n % 3 === 0 ? 'sarch_bench' : n % 3 === 1 ? 'search_bench' : 'not_present_keyword'
    )
    await waitForExpression(renderer, `window.searchMeasurements.input.length === ${n + 1}`)
    if (n % 3 !== 2) {
      await pressKey(renderer, 'ArrowDown', 'ArrowDown', 40)
      await waitForExpression(
        renderer,
        `window.searchMeasurements.arrows.length === ${Math.floor(n / 3) * 2 + (n % 3) + 1}`
      )
    }
    await pressKey(renderer, 'Escape', 'Escape', 27)
    await waitForExpression(renderer, '!document.querySelector("[data-quick-search]")')
    const samples = await renderer.evaluate('window.searchMeasurements')
    report.samples = samples
    await writeFile(join(output, 'samples.json'), JSON.stringify(report, null, 2))
  }
  await renderer.evaluate('window.measuringSearch = false; true')
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
      count: sorted.length
    }
  }
  report.summary = {
    openingMs: stats(report.samples.open),
    inputToPaintMs: stats(report.samples.input),
    arrowToPaintMs: stats(report.samples.arrows),
    maxMountedOptions: Math.max(...report.samples.mounted),
    longTasks: report.samples.longTasks
  }
  await openQuickSearch(renderer)
  await searchQuickly(renderer, 'search_bench')
  const capture = async (theme, scope) => {
    await updateRendererSettings(renderer, { theme })
    await waitForExpression(renderer, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`)
    await renderer.evaluate(
      'new Promise(resolve => setTimeout(() => requestAnimationFrame(() => resolve(true)), 220))'
    )
    const screenshot = await renderer.call('Page.captureScreenshot')
    await writeFile(join(output, `${theme}-${scope}.png`), Buffer.from(screenshot.data, 'base64'))
    report.visualStates ??= {}
    report.visualStates[`${theme}-${scope}`] = await renderer.evaluate(`(() => {
      const root = document.querySelector('[data-quick-search]');
      const list = root.querySelector('[role=listbox]');
      return { dialog: getComputedStyle(root.closest('[role=dialog]')).backgroundColor,
        input: getComputedStyle(root.querySelector('input')).backgroundColor,
        highlight: getComputedStyle(root.querySelector('mark')).backgroundColor,
        mounted: root.querySelectorAll('[role=option]').length,
        width: root.getBoundingClientRect().width, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight };
    })()`)
  }
  for (const theme of ['light', 'dark']) await capture(theme, 'all')
  for (const [name, total] of [
    ['Query Tabs', 100],
    ['Data Tabs', 800],
    ['Saved Queries', 1000],
    ['Query History', 1000]
  ]) {
    await selectSearchGroup(renderer, name)
    assert.equal(
      await renderer.evaluate(
        'Number(document.querySelector("[data-quick-search] [role=listbox] [role=presentation] span")?.textContent)'
      ),
      total
    )
  }
  await selectSearchGroup(renderer, 'Connections')
  const beforeScroll = await renderer.evaluate(
    'document.querySelector("[data-quick-search] [role=listbox]").scrollTop'
  )
  await renderer.evaluate(
    'document.querySelector("[data-quick-search] [role=listbox]").scrollTop = 5000; true'
  )
  await waitForExpression(
    renderer,
    `document.querySelector('[data-quick-search] [role=listbox]').scrollTop > ${beforeScroll}`
  )
  assert.ok(
    await renderer.evaluate('document.querySelectorAll("[data-quick-search] [role=option]").length < 30')
  )
  for (const theme of ['light', 'dark']) {
    await capture(theme, 'connections')
  }
  await pressKey(renderer, 'Escape', 'Escape', 27)
  assertRuntimeHealthy(clients, application)
  await quitPackaged(application, main, clients)
  assert.ok(
    report.summary.openingMs.p95 <= 100,
    `Opening p95 ${report.summary.openingMs.p95}ms exceeds 100ms`
  )
  assert.ok(
    report.summary.inputToPaintMs.p95 <= 150,
    `Input p95 ${report.summary.inputToPaintMs.p95}ms exceeds 150ms`
  )
  report.passed = true
  console.log(JSON.stringify(report.summary, null, 2))
} catch (error) {
  report.passed = false
  report.error = error.stack
  if (renderer) {
    const screenshot = await renderer.call('Page.captureScreenshot').catch(() => undefined)
    if (screenshot) await writeFile(join(output, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
  }
  throw error
} finally {
  for (const client of clients) client.close()
  await application?.stop()
  await writeFile(join(output, 'electron.log'), application?.logs ?? '')
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await rm(profile, { recursive: true, force: true })
}
