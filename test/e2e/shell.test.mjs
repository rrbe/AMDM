import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clickElement,
  DebuggerClient,
  waitForExpression,
  waitForTarget,
} from '../helpers/packagedElectron.mjs'
import { runShellScenario } from '../helpers/shellUi.mjs'

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
