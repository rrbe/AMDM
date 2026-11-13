import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import test from 'node:test'
import { clickElement, waitForExpression } from '../helpers/packagedElectron.mjs'
import { runShellScenario } from '../helpers/shellUi.mjs'

test('Query charts render BSON results and preserve configuration and page scope', { timeout: 120_000 }, () =>
  runShellScenario('query-charts', async ({ renderer, main, mongo, enterQuery, key, modifier, report }) => {
    await mongo.db('amdm_e2e').collection('chartSales').insertMany([
      ...Array.from({ length: 12 }, () => ({ status: 'paid' })),
      ...Array.from({ length: 3 }, () => ({ status: 'pending' })),
      { status: 'cancelled' }
    ])
    await renderer.evaluate(`(() => {
      window.chartLabels = new Set();
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (this.canvas.closest('[data-chart-view]')) window.chartLabels.add(text);
        return fillText.call(this, text, ...args);
      };
    })()`)
    async function labels(dimension, metric) {
      await waitForExpression(renderer, `window.chartLabels.has(${JSON.stringify('Dimension: ' + dimension)}) && window.chartLabels.has(${JSON.stringify('Metric: ' + metric)})`)
    }
    const button = label => `document.querySelector('button[aria-label=${JSON.stringify(label)}]')`
    async function run(code) {
      const count = await renderer.evaluate('document.querySelectorAll(".rtab").length')
      await enterQuery(code)
      await key('Enter', 'Enter', 13, modifier)
      await waitForExpression(renderer, `document.querySelectorAll('.rtab').length === ${Math.max(count, 1) + 1}`)
      await waitForExpression(renderer, '!!document.querySelector("button[aria-label=Chart]")')
      await clickElement(renderer, button('Chart'))
      await waitForExpression(renderer, '!!document.querySelector("[data-chart-view]")')
    }
    async function field(label, value) {
      const multiple = label === 'Metric' && await renderer.evaluate('document.querySelector("[data-chart-type]").dataset.chartType !== "pie"')
      const trigger = label === 'Dimension'
        ? `${button('Add dimension')} || ${button('Change dimension')}`
        : `${button('Add metric')} || ${button('Change metric')}`
      await clickElement(renderer, trigger)
      await waitForExpression(renderer, 'document.activeElement === document.querySelector(".amdm-field-select-popup input") && !!document.activeElement?.closest(".amdm-field-select-popup")')
      await renderer.call('Input.insertText', { text: value })
      await waitForExpression(renderer, `[...document.querySelectorAll('.amdm-field-select-popup [role=option]')].some(el => el.textContent.trim() === ${JSON.stringify(value)})`)
      await clickElement(renderer, `[...document.querySelectorAll('.amdm-field-select-popup [role=option]')].find(el => el.textContent.trim() === ${JSON.stringify(value)})`)
      if (multiple) await key('Escape', 'Escape', 27)
      await waitForExpression(renderer, '!document.querySelector(".amdm-field-select-popup")')
    }
    async function type(label, type) {
      await renderer.evaluate('window.chartLabels.clear()')
      await clickElement(renderer, button(label))
      await waitForExpression(renderer, `!!document.querySelector('[data-chart-type=${type}]')`)
    }
    async function plotted(count) {
      await waitForExpression(renderer, `document.querySelector('[data-chart-points]')?.dataset.chartPoints === '${count}'`)
      assert.equal(await renderer.evaluate(`(() => {
        const canvas = document.querySelector('[data-chart-view] canvas');
        if (!canvas || !canvas.width || !canvas.height) return false;
        return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
      })()`), true)
    }
    async function screenshot(name) {
      const shot = await renderer.call('Page.captureScreenshot')
      await writeFile(new URL(`../../dist/e2e-validation/query-charts/${name}.png`, import.meta.url), Buffer.from(shot.data, 'base64'))
    }

    await run('db.chartRuns.insertOne({ marker: "once" }); db.chartSales.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $project: { _id: 0, status: "$_id", count: 1, amount: { $multiply: ["$count", 10] } } }, { $sort: { count: -1 } }])')
    await field('Dimension', 'status')
    await field('Metric', 'count')
    await plotted(3)
    assert.match(await renderer.evaluate('document.querySelector("[data-chart-scope]").textContent'), /Complete query result · 3 rows/)
    await labels('status', 'count')
    await field('Metric', 'amount')
    await waitForExpression(renderer, 'window.chartLabels.has("count") && window.chartLabels.has("amount") && window.chartLabels.has("Metrics")')
    assert.deepEqual(await renderer.evaluate('[...document.querySelectorAll("[data-chart-view] [role=list][aria-label=Metrics] [role=listitem]")].map(el => el.querySelector("span[title]").textContent)'), ['count', 'amount'])
    await clickElement(renderer, button('Remove metric count'))
    await waitForExpression(renderer, `!${button('Remove metric count')}`)
    await field('Metric', 'count')
    await screenshot('bar')
    await type('Line', 'line')
    await plotted(3)
    await waitForExpression(renderer, 'window.chartLabels.has("count") && window.chartLabels.has("amount") && window.chartLabels.has("Metrics")')
    await type('Pie', 'pie')
    await plotted(3)
    await labels('status', 'amount')
    await field('Metric', 'count')
    await labels('status', 'count')
    await field('Metric', 'amount')
    await labels('status', 'amount')
    await type('Bar', 'bar')
    await waitForExpression(renderer, 'window.chartLabels.has("count") && window.chartLabels.has("amount") && window.chartLabels.has("Metrics")')
    await type('Pie', 'pie')
    await labels('status', 'amount')
    await screenshot('pie')
    await clickElement(renderer, button('Table'))
    await waitForExpression(renderer, '!document.querySelector("[data-chart-view]")')
    await clickElement(renderer, button('Chart'))
    await waitForExpression(renderer, '!!document.querySelector("[data-chart-type=pie]")')
    await plotted(3)
    assert.equal(await renderer.evaluate('document.querySelector("[data-chart-view] [role=list][aria-label=Metrics] [role=listitem] span[title]").textContent'), 'amount')
    assert.equal(await mongo.db('amdm_e2e').collection('chartRuns').countDocuments(), 1)
    report.steps.push('bar and line render multiple metrics; pie retains a single metric, and view switches retain both selections without rerunning the script')

    await renderer.evaluate('document.documentElement.setAttribute("data-theme", "dark")')
    await main.evaluate(`(() => { const { BrowserWindow } = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); BrowserWindow.getAllWindows()[0].setSize(1080, 760); })()`)
    await waitForExpression(renderer, 'innerWidth === 1080')
    await plotted(3)
    await screenshot('pie-dark')
    assert.equal(await renderer.evaluate(`(() => { const host = document.querySelector('[data-chart-type]'); return host.clientWidth > 200 && host.clientHeight > 100 && host.querySelector('canvas').clientWidth === host.clientWidth; })()`), true)
    assert.equal(await renderer.evaluate(`(() => {
      const group = document.querySelector('.view-switch').getBoundingClientRect();
      return [...document.querySelectorAll('.view-switch button')].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= group.left && rect.right <= group.right + 1 && rect.right <= innerWidth;
      });
    })()`), true)
    report.steps.push('dark theme and native window resizing keep the canvas fitted and every view button visible')
    await renderer.evaluate('document.documentElement.setAttribute("data-theme", "light")')

    await run('db.pages.find({}, { _id: 0, n: 1, marker: 1 }).sort({ n: 1 })')
    await field('Dimension', 'n')
    await field('Metric', 'n')
    await type('Line', 'line')
    await plotted(50)
    assert.match(await renderer.evaluate('document.querySelector("[data-chart-scope]").textContent'), /Current page · 50 rows/)
    for (const range of ['51–100', '101–105']) {
      await clickElement(renderer, button('Next page'))
      await waitForExpression(renderer, `document.querySelector('.result-range')?.textContent === '${range}'`)
    }
    await plotted(5)
    assert.match(await renderer.evaluate('document.querySelector("[data-chart-scope]").textContent'), /Current page · 5 rows/)
    await screenshot('line-last-page')
    report.steps.push('line chart paginates using the existing result; the final partial page is not labeled as complete')

    await run('db.chartSales.find({}, { _id: 0, status: 1 }).limit(2).map(d => ({ status: d.status, amount: NumberDecimal("1.234567890123456789") }))')
    await field('Dimension', 'status')
    await field('Metric', 'amount')
    await plotted(2)
    assert.match(await renderer.evaluate('document.querySelector("[data-chart-view]").textContent'), /Decimal values are plotted approximately/)
    await type('Pie', 'pie')
    await waitForExpression(renderer, 'document.querySelector("[data-chart-view] [role=status]")?.textContent.includes("Dimension labels repeat")')
    report.steps.push('Decimal results retain a precision notice and duplicate dimension values are rejected in pie charts')

    await clickElement(renderer, button('Aggregation for amount'))
    await waitForExpression(renderer, '[...document.querySelectorAll(".amdm-select-popup")].some(el => el.checkVisibility())')
    await clickElement(renderer, '[...document.querySelectorAll(".amdm-select-popup [role=option]")].find(el => el.checkVisibility() && el.textContent.trim() === "Sum")')
    await plotted(1)
    await labels('status', 'amount · Sum')
    await clickElement(renderer, button('Change metric'))
    await waitForExpression(renderer, '!!document.querySelector(".amdm-field-select-popup button[aria-pressed]")')
    await clickElement(renderer, 'document.querySelector(".amdm-field-select-popup button[aria-pressed]")')
    await plotted(1)
    await labels('status', 'Record count')
    report.steps.push('sum and record-count metrics group repeated dimensions on the current result page')

    await run('db.pages.find({ n: 0 }).map(d => Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["field" + i, i])))')
    await clickElement(renderer, button('Add dimension'))
    await waitForExpression(renderer, 'document.activeElement === document.querySelector(".amdm-field-select-popup input") && !!document.activeElement?.closest(".amdm-field-select-popup")')
    await waitForExpression(renderer, 'document.querySelectorAll(".amdm-field-select-popup [role=option]").length > 0')
    assert.ok(await renderer.evaluate('document.querySelectorAll(".amdm-field-select-popup [role=option]").length > 0 && document.querySelectorAll(".amdm-field-select-popup [role=option]").length < 30'))
    await key('Escape', 'Escape', 27)
    await field('Dimension', 'field499')
    await field('Metric', 'field498')
    await plotted(1)
    report.steps.push('500-field results virtualize choices while search can reach the last field')

    await run('Array.from({ length: 2000 }, (_, n) => ({ n, value: Math.sin(n / 50) }))')
    await clickElement(renderer, button('Show'))
    await waitForExpression(renderer, '!!document.querySelector(".amdm-select-popup")')
    await clickElement(renderer, '[...document.querySelectorAll(".amdm-select-popup [role=option]")].find(el => el.textContent.trim() === "2000")')
    await waitForExpression(renderer, 'document.querySelector(".result-range")?.textContent === "1–2000"')
    await field('Dimension', 'n')
    await field('Metric', 'value')
    await type('Line', 'line')
    await plotted(2000)
    await labels('n', 'value')
    await screenshot('line-2000')
    report.steps.push('the maximum display page of 2000 documents renders as a line chart')
    report.steps.push('bar, line and pie charts draw the selected dimension and metric names inside their canvas')
  })
)
