import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import {
  assertRuntimeHealthy,
  clickElement,
  DebuggerClient,
  launchPackaged,
  quitPackaged,
  waitForExpression,
  waitForTarget,
  waitForUi,
} from '../helpers/packagedElectron.mjs'

const root = resolve(import.meta.dirname, '../..')
const diagnostics = join(root, 'dist/e2e-validation/shell')

test(
  'packaged UI connects, executes Shell queries, switches result views, and opens Settings',
  { timeout: 120_000 },
  async () => {
    await mkdir(diagnostics, { recursive: true })
    await Promise.all(
      ['shell.png', 'failure.png'].map((name) => rm(join(diagnostics, name), { force: true })),
    )
    const profile = await mkdtemp(join(tmpdir(), 'amdm-e2e-'))
    const clients = [],
      report = { platform: process.platform, arch: process.arch, steps: [] }
    let replicaSet, mongo, application, renderer
    try {
      replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
      mongo = new MongoClient(replicaSet.getUri())
      await mongo.connect()
      await mongo
        .db('amdm_e2e')
        .collection('items')
        .insertMany(
          Array.from({ length: 3 }, (_, n) => ({
            n,
            marker: `e2e-visible-${n}`,
            nested: { value: n },
          })),
        )
      const uri = new URL(replicaSet.getUri())
      const connection = {
        id: 'e2e',
        name: 'E2E connection',
        useSrv: false,
        host: uri.host,
        replicaSet: uri.searchParams.get('replicaSet'),
        defaultDatabase: 'amdm_e2e',
        auth: { type: 'none' },
        ssh: { enabled: false },
        tls: { enabled: false },
      }
      // Arrange an isolated saved connection; all connection/query actions below use UI input.
      await writeFile(
        join(profile, 'connections.json'),
        JSON.stringify({ version: 1, connections: [connection] }),
      )
      await writeFile(
        join(profile, 'settings.json'),
        JSON.stringify({
          version: 1,
          settings: { language: 'en', automaticUpdateChecks: false },
        }),
      )
      application = await launchPackaged(root, profile)
      renderer = await DebuggerClient.connect(
        (await waitForTarget(application.rendererPort, (target) => target.type === 'page'))
          .webSocketDebuggerUrl,
      )
      clients.push(renderer)
      await waitForUi(renderer)
      const main = await DebuggerClient.connect(
        (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl,
      )
      clients.push(main)
      await clickElement(renderer, 'document.querySelector(".conn-item")', 2)
      await waitForExpression(
        renderer,
        '!!document.querySelector(".conn-status[aria-label=Connected]")',
      )
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".tree-label")].find(label => label.textContent === "amdm_e2e")?.closest(".tree-node")',
      )
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".tree-label")].find(label => label.textContent === "items")?.closest(".tree-node")',
        2,
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".database-title")?.textContent === "amdm_e2e"',
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-meta")?.textContent.includes("3 docs")',
      )
      report.steps.push('connected through Explorer and browsed a collection in a query tab')

      async function key(key, code, virtualKey, modifiers) {
        const parameters = { key, code, windowsVirtualKeyCode: virtualKey, modifiers }
        await renderer.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...parameters })
        await renderer.call('Input.dispatchKeyEvent', { type: 'keyUp', ...parameters })
      }
      const modifier = process.platform === 'darwin' ? 4 : 2
      async function enterQuery(code) {
        await clickElement(renderer, 'document.querySelector(".cm-content[contenteditable=true]")')
        await key('a', 'KeyA', 65, modifier)
        await renderer.call('Input.insertText', { text: code })
        await waitForExpression(
          renderer,
          `document.querySelector('.cm-content')?.textContent === ${JSON.stringify(code)}`,
        )
        assert.equal(
          await renderer.evaluate('document.activeElement?.classList.contains("cm-content")'),
          true,
        )
      }
      await enterQuery('db.items.find({n:{$lt:2}}).sort({n:1})')
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".work-actions button")].find(button => button.textContent.trim() === "Run")',
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-meta")?.textContent.includes("2 docs")',
      )
      await clickElement(renderer, 'document.querySelector(".result-bar button[aria-label=JSON]")')
      await waitForExpression(
        renderer,
        'document.querySelector(".result-body")?.textContent.includes("e2e-visible-1")',
      )
      const jsonText = await renderer.evaluate('document.querySelector(".result-body").textContent')
      assert.match(jsonText, /e2e-visible-0/)
      assert.doesNotMatch(jsonText, /e2e-visible-2/)
      await clickElement(renderer, 'document.querySelector(".result-bar button[aria-label=Table]")')
      await waitForExpression(renderer, '!!document.querySelector(".result-body .table-scroller")')
      report.steps.push('Run button produced two documents; JSON and Table views rendered')

      await enterQuery('db.items.find({n:2})')
      await key('Enter', 'Enter', 13, modifier)
      await waitForExpression(
        renderer,
        'document.querySelector(".result-meta")?.textContent.includes("1 doc")',
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-body")?.textContent.includes("e2e-visible-2")',
      )
      report.steps.push('editor keyboard shortcut produced the third document')

      await clickElement(renderer, 'document.querySelector("button[aria-label=Settings]")')
      const settings = await DebuggerClient.connect(
        (
          await waitForTarget(application.rendererPort, (target) =>
            target.url.includes('#settings'),
          )
        ).webSocketDebuggerUrl,
      )
      clients.push(settings)
      await waitForExpression(
        settings,
        `!!document.querySelector('input[placeholder="Search settings"]')`,
      )
      assert.equal(await settings.evaluate('typeof window.api'), 'object')
      assert.equal(await settings.evaluate('typeof window.require'), 'undefined')
      report.steps.push('Settings button opened a rendered, isolated Settings window')
      assertRuntimeHealthy(clients, application)
      const screenshot = await renderer.call('Page.captureScreenshot')
      await writeFile(join(diagnostics, 'shell.png'), Buffer.from(screenshot.data, 'base64'))
      await quitPackaged(application, main, clients)
      report.passed = true
    } catch (error) {
      report.passed = false
      report.error = error.stack
      if (renderer) {
        const screenshot = await renderer.call('Page.captureScreenshot').catch(() => undefined)
        if (screenshot)
          await writeFile(join(diagnostics, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
        report.dom = await renderer.evaluate('document.body.innerText').catch(() => undefined)
      }
      throw error
    } finally {
      for (const client of clients) client.close()
      await application?.stop()
      await writeFile(join(diagnostics, 'electron.log'), application?.logs ?? '')
      await writeFile(join(diagnostics, 'report.json'), JSON.stringify(report, null, 2))
      await mongo?.close()
      await replicaSet?.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
)
