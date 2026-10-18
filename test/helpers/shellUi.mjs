import assert from 'node:assert/strict'
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
} from './packagedElectron.mjs'

import { pressKey, primaryModifier } from './quickSearch.mjs'

const root = resolve(import.meta.dirname, '../..')

export async function runShellScenario(name, exercise) {
  const diagnostics = join(root, 'dist/e2e-validation', name)
  await mkdir(diagnostics, { recursive: true })
  await Promise.all(
    ['success.png', 'failure.png'].map((name) => rm(join(diagnostics, name), { force: true })),
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
    await mongo
      .db('amdm_e2e')
      .collection('pages')
      .insertMany(Array.from({ length: 105 }, (_, n) => ({ n, marker: `page-${n}` })))
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
    // Hosted desktops can show the window without giving it native input focus.
    await main.evaluate(`setTimeout(() => {
      const { BrowserWindow } = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
      window.webContents.focus();
    }, 0); true`)
    await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await waitForExpression(renderer, 'document.hasFocus() && document.visibilityState === "visible"')
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

    const modifier = primaryModifier
    const key = (...args) => pressKey(renderer, ...args)
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
    await exercise({
      renderer,
      main,
      application,
      clients,
      mongo,
      report,
      enterQuery,
      key,
      modifier,
    })
    assertRuntimeHealthy(clients, application)
    const screenshot = await renderer.call('Page.captureScreenshot')
    await writeFile(join(diagnostics, 'success.png'), Buffer.from(screenshot.data, 'base64'))
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
}
