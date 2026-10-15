import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  DebuggerClient, launchPackaged, waitForTarget, waitForExpression, clickElement, assertRuntimeHealthy,
} from '../helpers/packagedElectron.mjs'

const root = resolve(import.meta.dirname, '../..')

test(
  'Web defers settings and completion downloads and serves compressed ESM assets',
  { timeout: 120_000 },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), 'amdm-web-loading-'))
    const clients = []
    let backend, proxy, app
    let logs = ''
    async function listen(server) {
      await new Promise((r) => server.listen(0, '127.0.0.1', r))
      return server.address().port
    }
    try {
      const reservation = createServer()
      const backendPort = await listen(reservation)
      await new Promise((r) => reservation.close(r))
      proxy = createServer((req, res) => {
        const upstream = request(
          {
            host: '127.0.0.1',
            port: backendPort,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, 'x-forwarded-user': 'loading-test' },
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers)
            response.pipe(res)
          },
        )
        upstream.on('error', (error) => res.destroy(error))
        req.pipe(upstream)
        res.on('close', () => upstream.destroy())
      })
      const port = await listen(proxy),
        origin = `http://127.0.0.1:${port}`
      backend = spawn(process.execPath, [join(root, 'out/web-server/index.mjs')], {
        cwd: profile,
        env: {
          ...process.env,
          AMDM_WEB_ORIGIN: origin,
          AMDM_WEB_PORT: String(backendPort),
          AMDM_WEB_DATA_DIR: join(profile, 'data'),
          AMDM_WEB_MASTER_KEY: Buffer.alloc(32, 2).toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      backend.stdout.on('data', (c) => (logs += c))
      backend.stderr.on('data', (c) => (logs += c))
      for (let i = 0; i < 400 && !logs.includes('AMDM Web listening'); i++) await delay(25)
      assert.match(logs, /AMDM Web listening/)
      app = await launchPackaged(root, profile)
      await waitForTarget(app.rendererPort, (t) => t.type === 'page' && t.url.startsWith('file://'))
      const main = await DebuggerClient.connect((await waitForTarget(app.mainPort, () => true)).webSocketDebuggerUrl)
      clients.push(main)
      await main.evaluate(
        `setTimeout(()=>{ const {BrowserWindow}=process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, 'package.json'))})('electron'); globalThis.loadingWindow=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});void globalThis.loadingWindow.loadURL('about:blank'); },0);true`,
      )
      const renderer = await DebuggerClient.connect(
        (await waitForTarget(app.rendererPort, (t) => t.type === 'page' && t.url === 'about:blank'))
          .webSocketDebuggerUrl,
      )
      clients.push(renderer)
      await renderer.call('Network.enable')
      await renderer.call('Network.setCacheDisabled', { cacheDisabled: true })
      await renderer.call('Page.enable')
      await renderer.call('Page.navigate', { url: origin })
      await waitForExpression(
        renderer,
        '!!document.querySelector(".cm-content") && !!document.querySelector(".side-foot-version")?.textContent.trim()',
      )
      await delay(1500)
      const initial = renderer.events
        .filter((e) => e.method === 'Network.responseReceived')
        .map((e) => ({
          url: e.params.response.url.replace(origin, ''),
          encoding: e.params.response.headers['content-encoding'],
          mime: e.params.response.mimeType,
        }))
      const initialWorkers = await renderer.evaluate(
        'performance.getEntriesByType("resource").filter(e=>e.name.includes("tsService.worker")).map(e=>e.name)',
      )
      assert.deepEqual(initialWorkers, [])
      assert.ok(!initial.some((resource) => /SettingsWindow|SavedQueriesPanel/.test(resource.url)))
      assert.equal(initial.find((resource) => /\/index-.*\.js$/.test(resource.url))?.encoding, 'br')
      assert.equal(initial.find((resource) => /\.css$/.test(resource.url))?.encoding, 'br')
      await main.evaluate(
        'setTimeout(()=>{globalThis.loadingWindow.show();globalThis.loadingWindow.focus();globalThis.loadingWindow.webContents.focus()},0);true',
      )
      await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true })
      await clickElement(renderer, 'document.querySelector(".cm-content")', 1, false)
      await renderer.call('Input.insertText', { text: 'db.' })
      await waitForExpression(renderer, '!!document.querySelector(".cm-tooltip-autocomplete")')
      await waitForExpression(
        renderer,
        'performance.getEntriesByType("resource").some(e=>e.name.includes("tsService.worker"))',
      )
      const completion = await renderer.evaluate('document.querySelector(".cm-tooltip-autocomplete").textContent')
      await renderer.evaluate('window.api.app.openSettings()')
      await waitForExpression(renderer, '!!document.querySelector("[role=dialog]")')
      const after = renderer.events
        .filter((e) => e.method === 'Network.responseReceived')
        .map((e) => e.params.response.url.replace(origin, ''))
      assert.ok(after.some((url) => /SettingsWindow/.test(url)))
      await renderer.evaluate('history.back()')
      await waitForExpression(renderer, '!document.querySelector("[role=dialog]")')
      await clickElement(renderer, 'document.querySelectorAll(".explorer-nav-item")[1]', 1, false)
      await waitForExpression(renderer, '!!document.querySelector(".library-view")')
      assert.ok(
        await renderer.evaluate(
          'performance.getEntriesByType("resource").some(e=>e.name.includes("SavedQueriesPanel"))',
        ),
      )
      // Exercise the emitted module worker directly: this checks the language service rather than its regex fallback.
      const workerMembers = await renderer.evaluate(`new Promise((resolve, reject) => {
   const url = performance.getEntriesByType('resource').find(e => e.name.includes('tsService.worker')).name;
   const worker = new Worker(url, {type:'module'});
   const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Completion Worker timed out')); }, 10000);
   worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error('Completion Worker failed')); };
   worker.onmessage = ({data}) => { if(data.type==='result') { clearTimeout(timeout); worker.terminate(); resolve(data.entries.map(entry=>entry.name)); } };
   worker.postMessage({type:'complete',seq:1,code:'db.getMongo().',pos:14});
 })`)
      assert.ok(workerMembers.includes('getDB'), JSON.stringify(workerMembers))
      assert.ok(completion.length > 0)
      console.log(
        JSON.stringify({
          initial: initial.filter((resource) => resource.url.startsWith('/assets/')),
          initialWorkers,
          workerMembers: workerMembers.length,
        }),
      )
      assertRuntimeHealthy(clients, app)
    } catch (error) {
      console.error(logs, app?.logs)
      throw error
    } finally {
      clients.forEach((c) => c.close())
      await app?.stop()
      if (backend?.exitCode == null) {
        const stopped = once(backend, 'exit')
        backend.kill('SIGTERM')
        await Promise.race([stopped, delay(5000)])
        if (backend.exitCode == null) backend.kill('SIGKILL')
      }
      proxy?.closeAllConnections()
      if (proxy) await new Promise((r) => proxy.close(r))
      await rm(profile, { recursive: true, force: true })
    }
  },
)
