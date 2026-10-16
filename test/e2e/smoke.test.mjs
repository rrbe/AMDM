import assert from 'node:assert/strict'
import test from 'node:test'
import { clickElement, waitForExpression } from '../helpers/packagedElectron.mjs'
import { runShellScenario } from '../helpers/shellUi.mjs'

test(
  'core UI connects, executes queries by button and shortcut, and renders JSON and Table',
  { timeout: 60_000 },
  () =>
    runShellScenario('smoke-shell', async ({ renderer, report, enterQuery, key, modifier }) => {
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
    }),
)
