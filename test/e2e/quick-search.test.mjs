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
  waitForUi
} from '../helpers/packagedElectron.mjs'
import {
  openQuickSearch,
  pressKey,
  primaryModifier,
  searchQuickly,
  selectSearchGroup,
  updateRendererSettings
} from '../helpers/quickSearch.mjs'

const root = resolve(import.meta.dirname, '../..')
const diagnostics = join(root, 'dist/e2e-validation/quick-search')

test(
  'quick search navigates loaded resources and queries, restores focus, and releases workers',
  { timeout: 120_000 },
  async () => {
    await mkdir(diagnostics, { recursive: true })
    const profile = await mkdtemp(join(tmpdir(), 'amdm-quick-search-e2e-'))
    const clients = []
    const report = { steps: [] }
    let replicaSet, mongo, application, renderer
    try {
      replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
      mongo = new MongoClient(replicaSet.getUri())
      await mongo.connect()
      await mongo
        .db('search_e2e')
        .collection('items')
        .insertMany([{ n: 1 }, { n: 2 }, { n: 3 }])
      const uri = new URL(replicaSet.getUri())
      const connection = {
        id: 'search',
        name: 'Search connection',
        host: uri.host,
        replicaSet: uri.searchParams.get('replicaSet'),
        defaultDatabase: 'search_e2e',
        auth: { type: 'none' },
        ssh: { enabled: false },
        tls: { enabled: false }
      }
      await writeFile(
        join(profile, 'connections.json'),
        JSON.stringify({
          version: 1,
          connections: [connection, { ...connection, id: 'offline', name: 'Offline connection' }]
        })
      )
      await writeFile(
        join(profile, 'settings.json'),
        JSON.stringify({ version: 1, settings: { language: 'en', automaticUpdateChecks: false } })
      )
      await writeFile(
        join(profile, 'queries.json'),
        JSON.stringify({
          version: 1,
          queries: [
            {
              id: 'saved',
              name: 'Saved items',
              code: 'db.items.find({ n: 2 })',
              connectionId: 'search',
              database: 'search_e2e',
              createdAt: 1,
              updatedAt: 1
            },
            {
              id: 'offline',
              name: 'Offline query',
              code: 'db.items.find()',
              connectionId: 'offline',
              database: 'search_e2e',
              createdAt: 1,
              updatedAt: 1
            }
          ],
          history: [1, 2, 3].map((n) => ({
            id: `history-${n}`,
            code: 'db.items.find({ n: 1 })',
            connectionId: 'search',
            database: 'search_e2e',
            ranAt: n,
            ok: true
          }))
        })
      )
      application = await launchPackaged(root, profile)
      renderer = await DebuggerClient.connect(
        (await waitForTarget(application.rendererPort, (target) => target.type === 'page'))
          .webSocketDebuggerUrl
      )
      const main = await DebuggerClient.connect(
        (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl
      )
      clients.push(renderer, main)
      await waitForUi(renderer)
      await renderer.evaluate(`window.searchWorkerStats = { created: 0, live: 0 }; window.originalWorker = window.Worker;
      window.Worker = class extends window.originalWorker {
        constructor(url, options) { super(url, options); this.searchWorker = String(url).includes('search.worker'); if(this.searchWorker) { searchWorkerStats.created++; searchWorkerStats.live++; } }
        terminate() { if(this.searchWorker) { searchWorkerStats.live--; this.searchWorker = false; } return super.terminate(); }
      }; true`)
      await clickElement(renderer, 'document.querySelector(".conn-item")', 2)
      await waitForExpression(renderer, '!!document.querySelector(".conn-status[aria-label=Connected]")')
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".tree-label")].find(label => label.textContent === "search_e2e")?.closest(".tree-node")'
      )
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".tree-label")].find(label => label.textContent === "items")?.closest(".tree-node")',
        2
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".result-total")?.textContent.includes("Total results: 3")'
      )
      const tabCount = await renderer.evaluate('document.querySelectorAll(".qtab").length')
      await clickElement(renderer, 'document.querySelector(".explorer-head .side-head-action:last-child")')
      await waitForExpression(renderer, '!!document.querySelector(".sidebar-toggle-open")')

      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'items')
      const backButton = `document.querySelector('[data-quick-search] button[aria-label="Back to all groups"]')`
      assert.equal(await renderer.evaluate(`!!${backButton}`), false)
      await selectSearchGroup(renderer, 'Connections')
      const scopedScreenshot = await renderer.call('Page.captureScreenshot')
      await writeFile(join(diagnostics, 'group-back.png'), Buffer.from(scopedScreenshot.data, 'base64'))
      await clickElement(renderer, backButton)
      await waitForExpression(
        renderer,
        `document.querySelector('[data-quick-search] [role=listbox]')?.dataset.searchScope === 'all' && document.querySelector('[data-quick-search] [role=listbox]')?.getAttribute('aria-busy') === 'false'`
      )
      assert.equal(await renderer.evaluate('document.activeElement?.getAttribute("role")'), 'combobox')
      assert.equal(await renderer.evaluate('document.querySelector("[data-quick-search] input").value'), 'items')
      assert.equal(
        await renderer.evaluate(`document.querySelector('[data-quick-search] button[aria-label="Search group"]').textContent.trim()`),
        'All'
      )
      assert.equal(await renderer.evaluate(`!!${backButton}`), false)
      report.steps.push('scoped search returns to all groups, preserving the search term and input focus')
      await clickElement(
        renderer,
        `[...document.querySelectorAll('[data-search-id]')].find(row => JSON.parse(row.dataset.searchId)[0] === 'connections' && row.textContent.includes('items'))`
      )
      await waitForExpression(
        renderer,
        'document.querySelector(".tree-node.active .tree-label")?.textContent === "items"'
      )
      assert.equal(await renderer.evaluate('document.querySelectorAll(".qtab").length'), tabCount)
      report.steps.push('catalog search reveals and selects without running another query')

      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'Saved items')
      assert.equal(await renderer.evaluate('document.activeElement?.getAttribute("role")'), 'combobox')
      await pressKey(renderer, 'Enter', 'Enter', 13)
      await waitForExpression(renderer, 'document.querySelector(".cm-content")?.textContent.includes("n: 2")')
      await waitForExpression(renderer, '!!document.activeElement?.closest(".cm-editor")')
      assert.equal(await renderer.evaluate('document.querySelectorAll(".qtab").length'), tabCount + 1)
      assert.equal(await renderer.evaluate('!!document.querySelector(".result-total")'), false)
      report.steps.push('stored query opens separately and does not execute')

      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'items')
      await selectSearchGroup(renderer, 'Data Tabs')
      await pressKey(renderer, 'Enter', 'Enter', 13)
      await waitForExpression(
        renderer,
        'document.querySelector(".result-total")?.textContent.includes("Total results: 3")'
      )
      report.steps.push('data result switches to its owning query')

      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'items')
      await selectSearchGroup(renderer, 'Query History')
      assert.equal(
        await renderer.evaluate(
          `[...document.querySelectorAll('[data-quick-search] [role=option]')].some(row => row.textContent.includes('3 executions'))`
        ),
        true
      )
      await pressKey(renderer, 'Escape', 'Escape', 27)

      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'Offline query')
      await pressKey(renderer, 'Enter', 'Enter', 13)
      await waitForExpression(
        renderer,
        '!!document.querySelector("[role=dialog]") && !document.querySelector("[data-quick-search]")'
      )
      assert.match(
        await renderer.evaluate('document.querySelector("[role=dialog]").textContent'),
        /Offline connection/
      )
      await pressKey(renderer, 'Escape', 'Escape', 27)
      report.steps.push('history duplicates merge and offline query keeps its original connection prompt')

      await clickElement(renderer, 'document.querySelector(".cm-content[contenteditable=true]")')
      await openQuickSearch(renderer, true)
      assert.equal(
        await renderer.evaluate(
          `document.querySelector('[data-quick-search] button[aria-label="Search group"]').textContent.trim()`
        ),
        'Query Tabs'
      )
      await pressKey(renderer, 'Escape', 'Escape', 27)
      await waitForExpression(renderer, '!!document.activeElement?.closest(".cm-editor")')
      await openQuickSearch(renderer)
      await pressKey(renderer, 'k', 'KeyK', 75, primaryModifier)
      await waitForExpression(renderer, '!document.querySelector("[data-quick-search]")')
      assert.equal(await renderer.evaluate('window.searchWorkerStats.live'), 0)
      report.steps.push(
        'both shortcuts share the panel, Escape restores editor focus, and close terminates search workers'
      )

      await renderer.evaluate(
        'window.Worker = class { constructor() { throw new Error("E2E unavailable worker") } }; true'
      )
      await openQuickSearch(renderer)
      await searchQuickly(renderer, 'Saved items')
      assert.equal(
        await renderer.evaluate('document.querySelector("[data-quick-search]").dataset.searchEngine'),
        'inline'
      )
      assert.equal(await renderer.evaluate('document.querySelectorAll("[data-search-id]").length'), 1)
      await pressKey(renderer, 'Escape', 'Escape', 27)
      await renderer.evaluate('window.Worker = window.originalWorker; true')
      report.steps.push('worker failure retains correct cooperative search')
      await updateRendererSettings(renderer, { disabledKeyboardShortcuts: ['quickSearch'] })
      const paint = () =>
        renderer.evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
        )
      await paint()
      await pressKey(renderer, 'k', 'KeyK', 75, primaryModifier)
      await paint()
      assert.equal(await renderer.evaluate('!!document.querySelector("[data-quick-search]")'), false)
      await clickElement(renderer, `document.querySelector('button[aria-label="Quick Search"]')`)
      await waitForExpression(renderer, '!!document.querySelector("[data-quick-search]")')
      await pressKey(renderer, 'k', 'KeyK', 75, primaryModifier)
      await paint()
      assert.equal(await renderer.evaluate('!!document.querySelector("[data-quick-search]")'), true)
      await pressKey(renderer, 'Escape', 'Escape', 27)
      report.steps.push(
        'disabling Cmd/Ctrl+K applies both inside and outside the panel while mouse access remains available'
      )
      assertRuntimeHealthy(clients, application)
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
        report.focus = await renderer
          .evaluate(
            '({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute("role"), className: document.activeElement?.className, busy: document.querySelector("[data-quick-search] [role=listbox]")?.getAttribute("aria-busy"), selected: document.querySelector("[data-quick-search] [aria-selected=true]")?.dataset.searchId })'
          )
          .catch(() => undefined)
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
  }
)
