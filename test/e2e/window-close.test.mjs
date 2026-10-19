import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import {
  assertRuntimeHealthy,
  clickElement,
  DebuggerClient,
  launchPackaged,
  waitForExpression,
  waitForTarget,
  waitForUi,
} from '../helpers/packagedElectron.mjs'

const root = resolve(import.meta.dirname, '../..')

test(
  'last workspace close confirms, preserves cancellation, and awaits disconnect before exiting',
  { timeout: 60_000 },
  async () => {
    const diagnostics = join(root, 'dist/e2e-validation/window-close')
    await mkdir(diagnostics, { recursive: true })
    const profile = await mkdtemp(join(tmpdir(), 'amdm-close-'))
    const tracePath = join(profile, 'shutdown-trace.json')
    const clients = []
    let replicaSet, application, renderer
    const report = { steps: [] }
    try {
      replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
      const uri = new URL(replicaSet.getUri())
      await writeFile(
        join(profile, 'connections.json'),
        JSON.stringify({
          version: 1,
          connections: [
            {
              id: 'close-test',
              name: 'Close test',
              host: uri.host,
              useSrv: false,
              replicaSet: uri.searchParams.get('replicaSet'),
              auth: { type: 'none' },
              ssh: { enabled: false },
              tls: { enabled: false },
            },
          ],
        }),
      )
      await writeFile(
        join(profile, 'settings.json'),
        JSON.stringify({ version: 1, settings: { language: 'en', automaticUpdateChecks: false } }),
      )
      application = await launchPackaged(root, profile)
      renderer = await DebuggerClient.connect(
        (await waitForTarget(application.rendererPort, (target) => target.type === 'page'))
          .webSocketDebuggerUrl,
      )
      const main = await DebuggerClient.connect(
        (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl,
      )
      clients.push(renderer, main)
      await waitForUi(renderer)
      await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true })
      await main.evaluate(`(() => {
      globalThis.electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      globalThis.workspace = electron.BrowserWindow.getAllWindows()[0];
      workspace.show(); workspace.focus(); workspace.webContents.focus();
      globalThis.closeTrace = [];
      globalThis.closeResponse = 0;
      // Script native dialog choices at the Electron boundary, retaining real windows and IPC.
      electron.dialog.showMessageBox = async (_owner, options) => {
        closeTrace.push({ prompt: options.message, detail: options.detail, defaultId: options.defaultId });
        return { response: closeResponse, checkboxChecked: false };
      };
      // Main bundles the Driver, so observe its actual client through topology events.
      const { EventEmitter } = process.getBuiltinModule('events');
      const originalEmit = EventEmitter.prototype.emit;
      EventEmitter.prototype.emit = function (event, ...args) {
        if (event === 'topologyDescriptionChanged' && typeof this.db === 'function' && typeof this.close === 'function') {
          EventEmitter.prototype.emit = originalEmit;
          const originalClose = this.close;
          this.close = async function (...closeArgs) {
            closeTrace.push('disconnect:start');
            await originalClose.apply(this, closeArgs);
            await new Promise(resolve => setTimeout(resolve, 100));
            closeTrace.push('disconnect:done');
          };
        }
        return originalEmit.call(this, event, ...args);
      };
      electron.app.once('will-quit', () => {
        closeTrace.push('will-quit');
        process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(tracePath)}, JSON.stringify(closeTrace));
      });
      return true;
    })()`)

      await clickElement(renderer, 'document.querySelector(".conn-item")', 2)
      await waitForExpression(
        renderer,
        '!!document.querySelector(".conn-status[aria-label=Connected]")',
      )
      await clickElement(renderer, 'document.querySelector(".cm-content[contenteditable=true]")')
      await renderer.call('Input.insertText', { text: 'db.items.find({keep: "my query"})' })
      await waitForExpression(
        renderer,
        'document.querySelector(".cm-content")?.textContent.includes("my query")',
      )
      await main.evaluate('workspace.close(); true')
      await waitForExpression(main, 'closeTrace.filter(entry => entry.prompt).length === 1')
      assert.equal(
        await renderer.evaluate('document.querySelector(".cm-content").textContent'),
        'db.items.find({keep: "my query"})',
      )
      assert.equal(
        (await renderer.evaluate('window.api.session.status("close-test")')).state,
        'connected',
      )
      assert.deepEqual(
        await main.evaluate('closeTrace.filter(entry => typeof entry === "string")'),
        [],
      )
      report.steps.push('cancelled workspace close preserved query text and the live connection')

      await main.evaluate('electron.app.quit(); true')
      await waitForExpression(main, 'closeTrace.filter(entry => entry.prompt).length === 2')
      assert.equal(await main.evaluate('workspace.isDestroyed()'), false)
      report.steps.push('application quit used the same cancellable confirmation')

      await renderer.evaluate('window.api.app.openSettings()')
      await waitForExpression(main, 'electron.BrowserWindow.getAllWindows().length === 2')
      const screenshot = await renderer.call('Page.captureScreenshot')
      await writeFile(
        join(diagnostics, 'preserved-workspace.png'),
        Buffer.from(screenshot.data, 'base64'),
      )
      assertRuntimeHealthy(clients, application)
      // Keep Settings open: only workspace windows determine whether closing exits.
      await main.evaluate('closeResponse = 1; setTimeout(() => workspace.close(), 50); true')
      for (const client of clients) client.close()
      const exit = await application.waitForExit(5000)
      assert.ok(exit, 'Closing the last workspace must exit even with Settings open')
      assert.equal(exit.code, 0, JSON.stringify(exit))
      const trace = JSON.parse(await readFile(tracePath, 'utf8'))
      const completed = trace.indexOf('disconnect:done')
      assert.ok(completed > trace.indexOf('disconnect:start'), JSON.stringify(trace))
      assert.ok(trace.indexOf('will-quit') > completed, 'Exit must wait for MongoClient.close()')
      assert.equal(trace.filter((entry) => entry.prompt).length, 3)
      assert.ok(
        trace
          .filter((entry) => entry.prompt)
          .every((entry) => entry.defaultId === 0 && entry.detail.includes('will not be restored')),
      )
      report.steps.push(
        'confirmed last-window close awaited MongoClient.close(), then exited with Settings open',
      )
      report.trace = trace
      report.passed = true
    } catch (error) {
      report.error = error.stack
      throw error
    } finally {
      for (const client of clients) client.close()
      await application?.stop()
      await writeFile(join(diagnostics, 'electron.log'), application?.logs ?? '')
      await writeFile(join(diagnostics, 'report.json'), JSON.stringify(report, null, 2))
      await replicaSet?.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
)
