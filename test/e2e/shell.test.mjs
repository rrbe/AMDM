import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'
import {
  clickElement,
  DebuggerClient,
  waitForExpression,
  waitForTarget,
} from '../helpers/packagedElectron.mjs'
import { runShellScenario } from '../helpers/shellUi.mjs'

function queryMenuItem(label) {
  return `[...document.querySelectorAll('[role=menuitem]')].find(item => item.querySelector('.ctx-label')?.textContent === ${JSON.stringify(label)})`
}

async function openQueryMenu(renderer) {
  const point = await renderer.evaluate(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const range = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const rect = range.height ? range : document.querySelector('.cm-line').getBoundingClientRect();
    const point = { x: rect.x + Math.max(1, rect.width / 2), y: rect.y + rect.height / 2 };
    if (!document.elementFromPoint(point.x, point.y)?.closest('.editor-wrap')) throw new Error('Query menu point outside editor: ' + JSON.stringify({point, range, rect, active: document.activeElement?.outerHTML}));
    return point;
  })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await renderer.call('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, ...point })
  }
  await waitForExpression(renderer, '!!document.querySelector(".ctx-menu")')
}

async function queryMenuCommand(renderer, label) {
  await openQueryMenu(renderer)
  await clickElement(renderer, queryMenuItem(label))
}

function queryMenuState(renderer) {
  return renderer.evaluate(`Object.fromEntries([...document.querySelectorAll('[role=menuitem]')].map(item => [item.querySelector('.ctx-label').textContent, {
    disabled: item.getAttribute('aria-disabled') === 'true',
    shortcut: item.querySelector('.ctx-shortcut')?.textContent
  }]))`)
}

test('Query context menu editing commands preserve text, selection, and focus', { timeout: 90_000 }, () =>
  runShellScenario('shell-paste', async ({ renderer, main, report, enterQuery, key, modifier }) => {
    // Restore every clipboard format after exercising the native clipboard.
    await main.evaluate(`(async () => {
      const { clipboard, ClipboardItem, BrowserWindow } = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      const saved = await Promise.all((await clipboard.read()).map(async item =>
        new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
      globalThis.pasteTest = { clipboard, saved, contents: BrowserWindow.getAllWindows()[0].webContents };
    })()`)
    try {
      const original = 'db.items.find({ n: 1 })'
      const replacement = 'db.items.find({ n: 2 })'
      async function pasteFromMenu(text) {
        await main.evaluate(`pasteTest.clipboard.writeText(${JSON.stringify(text)})`)
        await queryMenuCommand(renderer, 'Paste')
      }
      const expectCode = code => waitForExpression(renderer, `document.querySelector('.cm-content')?.textContent === ${JSON.stringify(code)}`)
      await clickElement(renderer, 'document.querySelector(".cm-content")')
      await openQueryMenu(renderer)
      const initialMenu = await queryMenuState(renderer)
      assert.deepEqual(Object.keys(initialMenu), [
        'Cut', 'Copy', 'Paste', 'Select all', 'Undo', 'Redo', 'Find / Replace',
        'Format code', 'Save as…', 'Run script', 'Run current statement', 'Explain', 'Stop', 'Problems'
      ])
      assert.equal(initialMenu.Stop.disabled, true)
      assert.equal(initialMenu.Redo.disabled, true)
      const menuScreenshot = await renderer.call('Page.captureScreenshot')
      await writeFile(new URL('../../dist/e2e-validation/shell-paste/menu.png', import.meta.url), Buffer.from(menuScreenshot.data, 'base64'))
      await key('Escape', 'Escape', 27)
      await waitForExpression(renderer, 'document.activeElement?.classList.contains("cm-content")')
      report.steps.push('frequent editing commands appear first; Escape returns focus to the editor')

      await renderer.evaluate('Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" }); true')
      try {
        await openQueryMenu(renderer)
        const windowsMenu = await queryMenuState(renderer)
        assert.equal(windowsMenu.Copy.shortcut, 'Ctrl+C')
        assert.equal(windowsMenu.Redo.shortcut, 'Ctrl+Y')
        assert.equal(windowsMenu['Run script'].shortcut, 'Ctrl+Enter')
        assert.equal(windowsMenu['Format code'].shortcut, 'Ctrl+Shift+F')
        await key('Escape', 'Escape', 27)
      } finally {
        await renderer.evaluate('delete navigator.platform')
      }
      report.steps.push('Windows shortcut hints use Ctrl and match CodeMirror redo')

      await enterQuery(original)
      await key('a', 'KeyA', 65, modifier)
      await pasteFromMenu(replacement)
      await expectCode(replacement)
      assert.equal(await renderer.evaluate('document.activeElement?.classList.contains("cm-content")'), true)
      await key('z', 'KeyZ', 90, modifier)
      await expectCode(original)
      report.steps.push('context-menu Paste replaces selected code and one undo restores it')

      await enterQuery(original)
      for (let i = 0; i < 3; i++) await key('ArrowLeft', 'ArrowLeft', 37)
      await key('ArrowLeft', 'ArrowLeft', 37, 8)
      assert.equal(await renderer.evaluate('window.getSelection().toString()'), '1')
      await pasteFromMenu('2')
      await expectCode(replacement)
      report.steps.push('Paste replaces a partial selection without changing the surrounding code')

      await enterQuery(original)
      await pasteFromMenu('\n// pasted')
      await expectCode(original + '// pasted') // textContent omits CodeMirror line boundaries.
      report.steps.push('Paste inserts multiline text at an empty cursor')

      await enterQuery(original)
      await key('a', 'KeyA', 65, modifier)
      await main.evaluate(`pasteTest.clipboard.writeText(${JSON.stringify(replacement)})`)
      await main.evaluate('pasteTest.contents.paste(); true')
      await expectCode(replacement)
      report.steps.push('native paste command also replaces the selection')

      await enterQuery(original)
      await queryMenuCommand(renderer, 'Select all')
      await waitForExpression(renderer, `window.getSelection().toString() === ${JSON.stringify(original)}`)
      await queryMenuCommand(renderer, 'Copy')
      await waitForExpression(main, `pasteTest.clipboard.readText().then(text => text === ${JSON.stringify(original)})`)
      await expectCode(original)
      await queryMenuCommand(renderer, 'Cut')
      assert.equal(await main.evaluate('pasteTest.clipboard.readText()'), original)
      await expectCode('')
      await queryMenuCommand(renderer, 'Undo')
      await expectCode(original)
      await queryMenuCommand(renderer, 'Redo')
      await expectCode('')
      report.steps.push('Select all, Copy, Cut, Undo, and Redo operate on the editor selection')
      await openQueryMenu(renderer)
      const emptyMenu = await queryMenuState(renderer)
      for (const label of ['Cut', 'Copy', 'Select all', 'Redo', 'Format code', 'Save as…', 'Run script', 'Run current statement', 'Explain', 'Stop']) {
        assert.equal(emptyMenu[label].disabled, true, label)
      }
      assert.equal(emptyMenu.Undo.disabled, false)
      assert.equal(emptyMenu.Paste.disabled, false)
      await key('Escape', 'Escape', 27)
      report.steps.push('empty code and unavailable history disable only inapplicable commands')

      await enterQuery('db.items.find({n:1})')
      await queryMenuCommand(renderer, 'Format code')
      await expectCode('db.items.find({ n: 1 })')
      await queryMenuCommand(renderer, 'Find / Replace')
      await waitForExpression(renderer, 'document.activeElement?.name === "search"')
      await renderer.call('Input.insertText', { text: '1' })
      await clickElement(renderer, 'document.querySelector(".cm-search input[name=replace]")')
      await renderer.call('Input.insertText', { text: '2' })
      await clickElement(renderer, 'document.querySelector(".cm-search button[name=replaceAll]")')
      await expectCode(replacement)
      await clickElement(renderer, 'document.querySelector(".cm-search button[name=close]")')
      report.steps.push('Format code and Find / Replace update code and focus the search input')

      await enterQuery('unknownQueryName()')
      await queryMenuCommand(renderer, 'Problems')
      await waitForExpression(renderer, '!!document.querySelector(".cm-panel-lint .cm-diagnostic")')
      await clickElement(renderer, 'document.querySelector(".cm-panel-lint button[name=close]")')
      report.steps.push('Problems opens diagnostics and closes correctly')

      await enterQuery(original)
      await queryMenuCommand(renderer, 'Save as…')
      await waitForExpression(renderer, 'document.activeElement?.placeholder === "e.g. active users"')
      await renderer.call('Input.insertText', { text: 'Context menu saved query' })
      await clickElement(renderer, '[...document.querySelectorAll("[role=dialog] button")].find(button => button.textContent.trim() === "Save")')
      await waitForExpression(renderer, '!document.querySelector("[role=dialog]")')
      const saved = await renderer.evaluate('window.api.queries.list()')
      assert.ok(saved.some(query => query.name === 'Context menu saved query' && query.code === original))
      report.steps.push('Save as opens a focused dialog and persists the complete query')
    } finally {
      await main.evaluate(`(async () => { await pasteTest.clipboard.write(pasteTest.saved);
        delete globalThis.pasteTest; })()`)
    }
  }),
)

test('Query context menu execution commands use the correct scope and busy state', { timeout: 90_000 }, () =>
  runShellScenario('shell-menu-execution', async ({ renderer, mongo, report, enterQuery, key }) => {
    const write = 'db.effects.updateOne({_id:"menu"},{$inc:{runs:1}},{upsert:true});'
    const query = 'db.items.find({n:1})'
    const script = write + query
    const selectQuery = async () => {
      for (let i = 0; i < query.length; i++) await key('ArrowLeft', 'ArrowLeft', 37, 8)
      assert.equal(await renderer.evaluate('window.getSelection().toString()'), query)
    }
    const expectResult = marker => waitForExpression(renderer, `document.querySelector('.result-body')?.textContent.includes(${JSON.stringify(marker)})`)
    const runCount = async () => (await mongo.db('amdm_e2e').collection('effects').findOne({ _id: 'menu' })).runs
    await enterQuery(script)
    await selectQuery()
    await queryMenuCommand(renderer, 'Run script')
    await expectResult('e2e-visible-1')
    assert.equal(await runCount(), 1)
    report.steps.push('Run script executes the complete editor even when code is selected')

    await enterQuery(script)
    await selectQuery()
    await queryMenuCommand(renderer, 'Run selection')
    await waitForExpression(renderer, 'document.querySelectorAll(".rtab").length === 3')
    await expectResult('e2e-visible-1')
    assert.equal(await runCount(), 1)
    report.steps.push('Run selection executes only selected text')

    await enterQuery(script)
    await queryMenuCommand(renderer, 'Run current statement')
    await waitForExpression(renderer, 'document.querySelectorAll(".rtab").length === 4')
    await expectResult('e2e-visible-1')
    assert.equal(await runCount(), 1)
    report.steps.push('Run current statement executes only the statement at the cursor')

    await enterQuery(query)
    await queryMenuCommand(renderer, 'Explain')
    await waitForExpression(renderer, '!!document.querySelector(".explain-view .explain-card")')
    report.steps.push('Explain renders the execution plan from MongoDB')

    await enterQuery('db.items.find({$where:function(){const end=Date.now()+5000;while(Date.now()<end){};return true}})')
    await queryMenuCommand(renderer, 'Run script')
    await waitForExpression(renderer, '[...document.querySelectorAll(".work-actions button")].some(button => button.textContent.trim() === "Stop")')
    await openQueryMenu(renderer)
    const state = await renderer.evaluate(`Object.fromEntries([...document.querySelectorAll('[role=menuitem]')].map(item => [item.querySelector('.ctx-label').textContent, item.getAttribute('aria-disabled') === 'true']))`)
    for (const label of ['Run script', 'Run current statement', 'Explain', 'Save as…']) assert.equal(state[label], true, label)
    assert.equal(state.Stop, false)
    await clickElement(renderer, queryMenuItem('Stop'))
    await waitForExpression(renderer, '[...document.querySelectorAll(".work-actions button")].some(button => button.innerText.trim() === "Run")')
    await expectResult('Aborted')
    report.steps.push('Stop cancels a running MongoDB query; run/explain/save are disabled during execution')

    const connectionPoint = await renderer.evaluate(`(() => {
      const rect = document.querySelector('.conn-item').getBoundingClientRect();
      return { x: rect.x + 60, y: rect.y + rect.height / 2 };
    })()`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await renderer.call('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, ...connectionPoint })
    }
    await clickElement(renderer, queryMenuItem('Disconnect'))
    await waitForExpression(renderer, '!document.querySelector(".conn-status[aria-label=Connected]")')
    await clickElement(renderer, 'document.querySelector(".cm-content")')
    await openQueryMenu(renderer)
    const disconnectedMenu = await queryMenuState(renderer)
    for (const label of ['Run script', 'Run current statement', 'Explain', 'Stop']) assert.equal(disconnectedMenu[label].disabled, true, label)
    for (const label of ['Cut', 'Copy', 'Paste', 'Format code', 'Save as…', 'Problems']) assert.equal(disconnectedMenu[label].disabled, false, label)
    await key('Escape', 'Escape', 27)
    report.steps.push('disconnected queries retain editing and saving while execution commands are disabled')
  }),
)

test(
  'Shell pagination preserves per-result state and does not repeat writes',
  { timeout: 120_000 },
  () =>
    runShellScenario(
      'shell-pagination',
      async ({ renderer, mongo, report, enterQuery, key, modifier }) => {
        const pagingQuery =
          'db.effects.updateOne({_id:"once"},{$inc:{runs:1}},{upsert:true}); db.pages.find().sort({n:1}).limit(23)'
        await enterQuery(pagingQuery)
        await key('Enter', 'Enter', 13, modifier)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-total")?.textContent.includes("Total results: 23")',
        )
        const pagingResultId = await renderer.evaluate(
          'document.querySelector(".rtab.active").dataset.tabId',
        )
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
        assert.ok(
          paginationLayout.sectionPositions.every(
            (x, i, positions) => i === 0 || x > positions[i - 1],
          ),
        )
        assert.ok(
          paginationLayout.navigationPositions.every(
            (x, i, positions) => i === 0 || x > positions[i - 1],
          ),
        )
        const historyBefore = await renderer.evaluate(
          'window.api.history.list().then(entries=>entries.length)',
        )
        async function displaySize(size) {
          await clickElement(renderer, 'document.querySelector(".page-size [role=combobox]")')
          await clickElement(
            renderer,
            `[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.trim() === ${JSON.stringify(String(size))})`,
          )
        }
        await displaySize(5)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-range")?.textContent.trim() === "1–5"',
        )
        await clickElement(renderer, `document.querySelector('button[aria-label="Next page"]')`)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-range")?.textContent.trim() === "6–10"',
        )
        await displaySize(10)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-range")?.textContent.trim() === "1–10"',
        )
        assert.equal(
          await renderer.evaluate('document.querySelector(".cm-content").textContent'),
          pagingQuery,
        )
        assert.doesNotMatch(
          await renderer.evaluate('document.querySelector(".result-meta").textContent'),
          /docs?/,
        )
        assert.equal(
          await renderer.evaluate('window.api.history.list().then(entries=>entries.length)'),
          historyBefore,
        )
        assert.equal(
          (await mongo.db('amdm_e2e').collection('effects').findOne({ _id: 'once' })).runs,
          1,
        )
        await enterQuery('db.pages.find().sort({n:1}).limit(7)')
        await key('Enter', 'Enter', 13, modifier)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-total")?.textContent.includes("Total results: 7")',
        )
        assert.equal(
          await renderer.evaluate(
            'document.querySelector(".page-size [role=combobox]").textContent.trim()',
          ),
          '50',
        )
        await clickElement(
          renderer,
          `document.querySelector('.rtab[data-tab-id=${JSON.stringify(pagingResultId)}]')`,
        )
        await waitForExpression(
          renderer,
          'document.querySelector(".result-range")?.textContent.trim() === "1–10"',
        )
        assert.equal(
          await renderer.evaluate(
            'document.querySelector(".page-size [role=combobox]").textContent.trim()',
          ),
          '10',
        )
        report.steps.push(
          'display size and page navigation preserve query limits, result state, history, and one-time writes',
        )
        await enterQuery('db.pages.aggregate([{$sort:{n:1}},{$limit:53}])')
        await key('Enter', 'Enter', 13, modifier)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-total")?.textContent.includes("Pending")',
        )
        await clickElement(renderer, `document.querySelector('button[aria-label="Next page"]')`)
        await waitForExpression(
          renderer,
          'document.querySelector(".result-range")?.textContent.trim() === "51–53"',
        )
        await waitForExpression(
          renderer,
          'document.querySelector(".result-total")?.textContent.trim() === "Total results: 53"',
        )
        report.steps.push('aggregation pages confirm the exact total at cursor exhaustion')
      },
    ),
)

test('Settings opens in a separate Renderer with an isolated bridge', { timeout: 60_000 }, () =>
  runShellScenario('shell-settings', async ({ renderer, application, clients, report }) => {
    await clickElement(renderer, 'document.querySelector("button[aria-label=Settings]")')
    const settings = await DebuggerClient.connect(
      (await waitForTarget(application.rendererPort, (target) => target.url.includes('#settings')))
        .webSocketDebuggerUrl,
    )
    clients.push(settings)
    await waitForExpression(
      settings,
      `!!document.querySelector('input[placeholder="Search settings"]')`,
    )
    assert.equal(await settings.evaluate('typeof window.api'), 'object')
    assert.equal(await settings.evaluate('typeof window.require'), 'undefined')
    report.steps.push('Settings button opened a rendered, isolated Settings window')
  }),
)
