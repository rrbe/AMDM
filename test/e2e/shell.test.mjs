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
      await mongo.db('amdm_e2e').collection('pages').insertMany(
        Array.from({ length: 105 }, (_, n) => ({ n, marker: `page-${n}` }))
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
        'document.querySelector(".result-total")?.textContent.includes("Total results: 3")',
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
        '[...document.querySelectorAll(".work-actions button")].find(button => button.innerText.trim() === "Run")',
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-total")?.textContent.includes("Total results: 2")',
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
        'document.querySelector(".result-total")?.textContent.includes("Total results: 1")',
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-body")?.textContent.includes("e2e-visible-2")',
      )
      report.steps.push('editor keyboard shortcut produced the third document')

      const pagingQuery = 'db.effects.updateOne({_id:"once"},{$inc:{runs:1}},{upsert:true}); db.pages.find().sort({n:1}).limit(23)'
      await enterQuery(pagingQuery)
      await key('Enter', 'Enter', 13, modifier)
      await waitForExpression(renderer, 'document.querySelector(".result-total")?.textContent.includes("Total results: 23")')
      const paginationLayout = await renderer.evaluate(`(() => {
        const bar = document.querySelector('.result-pagination');
        const total = bar.querySelector('.result-total');
        const size = bar.querySelector('.page-size');
        const pager = bar.querySelector('.result-pager');
        const [previous, next] = pager.querySelectorAll('button');
        const range = pager.querySelector('.result-range');
        return {
          total: total.textContent.trim(),
          size: size.textContent.trim(),
          sectionPositions: [total, size, pager].map(e => e.getBoundingClientRect().x),
          navigationPositions: [previous, range, next].map(e => e.getBoundingClientRect().x)
        };
      })()`)
      assert.equal(paginationLayout.total, 'Total results: 23')
      assert.match(paginationLayout.size, /Show.*50.*rows/)
      assert.ok(paginationLayout.sectionPositions.every((x, i, positions) => i === 0 || x > positions[i - 1]))
      assert.ok(paginationLayout.navigationPositions.every((x, i, positions) => i === 0 || x > positions[i - 1]))
      const historyBefore = await renderer.evaluate('window.api.history.list().then(entries=>entries.length)')
      async function displaySize(size) {
        await clickElement(renderer, 'document.querySelector(".page-size [role=combobox]")')
        await clickElement(renderer, `[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.trim() === ${JSON.stringify(String(size))})`)
      }
      await displaySize(5)
      await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent.trim() === "1–5"')
      await clickElement(renderer, `document.querySelector('button[aria-label="Next page"]')`)
      await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent.trim() === "6–10"')
      await displaySize(10)
      await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent.trim() === "1–10"')
      assert.equal(await renderer.evaluate('document.querySelector(".cm-content").textContent'), pagingQuery)
      assert.doesNotMatch(await renderer.evaluate('document.querySelector(".result-meta").textContent'), /docs?/)
      assert.equal(await renderer.evaluate('window.api.history.list().then(entries=>entries.length)'), historyBefore)
      assert.equal((await mongo.db('amdm_e2e').collection('effects').findOne({_id:'once'})).runs, 1)
      await enterQuery('db.pages.find().sort({n:1}).limit(7)')
      await key('Enter', 'Enter', 13, modifier)
      await waitForExpression(renderer, 'document.querySelector(".result-total")?.textContent.includes("Total results: 7")')
      assert.equal(await renderer.evaluate('document.querySelector(".page-size [role=combobox]").textContent.trim()'), '50')
      await clickElement(renderer, 'document.querySelectorAll(".rtab")[3]')
      await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent.trim() === "1–10"')
      assert.equal(await renderer.evaluate('document.querySelector(".page-size [role=combobox]").textContent.trim()'), '10')
      report.steps.push('display size and page navigation preserve query limits, result state, history, and one-time writes')
      await enterQuery('db.pages.aggregate([{$sort:{n:1}},{$limit:53}])')
      await key('Enter', 'Enter', 13, modifier)
      await waitForExpression(renderer, 'document.querySelector(".result-total")?.textContent.includes("Pending")')
      await clickElement(renderer, `document.querySelector('button[aria-label="Next page"]')`)
      await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent.trim() === "51–53"')
      await waitForExpression(renderer, 'document.querySelector(".result-total")?.textContent.trim() === "Total results: 53"')
      report.steps.push('aggregation pages confirm the exact total at cursor exhaustion')

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
