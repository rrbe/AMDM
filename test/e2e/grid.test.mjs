import assert from 'node:assert/strict'
import test from 'node:test'
import { Long } from 'mongodb'
import { clickElement, waitForExpression } from '../helpers/packagedElectron.mjs'
import { runShellScenario } from '../helpers/shellUi.mjs'

test('Grid edits a projected document while preserving stored fields and BSON types', { timeout: 120_000 }, () =>
  runShellScenario('grid-edit-projection', async ({ renderer, enterQuery, key, modifier, mongo, report }) => {
    const collection = mongo.db('amdm_e2e').collection('items')
    const hidden = Long.fromNumber(42)
    await collection.insertOne({ _id: 'projected', name: 'before', hidden })
    await enterQuery('db.items.find({ _id: "projected" }, { name: 1 })')
    await key('Enter', 'Enter', 13, modifier)
    await clickElement(renderer, 'document.querySelector(".view-switch [aria-label=Grid]")')
    const card = 'document.querySelector("[data-doc-index]")'
    await waitForExpression(renderer, `${card}?.textContent.includes('before')`)
    assert.equal(await renderer.evaluate(`${card}.textContent.includes('hidden')`), false)
    await renderer.evaluate(`${card}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 400 }))`)
    await clickElement(renderer, `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Edit document'))`)
    const editor = 'document.querySelector("textarea.doc-edit-area")'
    await waitForExpression(renderer, `${editor} && !${editor}.disabled`)
    const doc = JSON.parse(await renderer.evaluate(`${editor}.value`))
    assert.deepEqual(doc.hidden, { $numberLong: '42' })
    await clickElement(renderer, editor)
    await renderer.evaluate(`${editor}.select()`)
    const replacement = JSON.stringify({ ...doc, name: 'after' })
    await renderer.call('Input.insertText', { text: replacement })
    assert.equal(await renderer.evaluate(`${editor}.value`), replacement)
    await clickElement(renderer, `[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Save')`)
    await waitForExpression(renderer, `!${editor}`)
    const stored = await collection.findOne({ _id: 'projected' }, { promoteValues: false })
    assert.equal(stored.name, 'after')
    assert.ok(Long.isLong(stored.hidden) && stored.hidden.equals(hidden))
    report.steps.push('edited a projected record and preserved the hidden BSON Long')
  }),
)

test('Grid keeps rendering when a focused card is beyond the end of the next page', { timeout: 120_000 }, () =>
  runShellScenario('grid-short-page', async ({ renderer, enterQuery, key, modifier, report }) => {
    await enterQuery('db.pages.find({ n: { $lt: 51 } }).sort({ n: 1 })')
    await key('Enter', 'Enter', 13, modifier)
    await waitForExpression(renderer, "document.querySelector('.result-range')?.textContent === '1–50'")
    await clickElement(renderer, 'document.querySelector(".view-switch [aria-label=Grid]")')
    await waitForExpression(renderer, '!!document.querySelector("[data-doc-index]")')
    await renderer.evaluate("document.querySelector('.result-body [tabindex=\"-1\"]').scrollTop = 1e6")
    const last = 'document.querySelector(\'[data-doc-index="49"] button\')'
    await waitForExpression(renderer, `!!${last}`)
    await renderer.evaluate(`document.querySelector('.result-pager button[aria-label="Next page"]').click(); ${last}.focus()`)
    await waitForExpression(renderer, "document.querySelector('.result-range')?.textContent === '51–51'")
    assert.deepEqual(await renderer.evaluate("[...document.querySelectorAll('[data-doc-index]')].map(card => card.dataset.docIndex)"), ['0'])
    report.steps.push('the final page renders one card after focus on the previous page')
  }),
)

test('Derived results with a stored document ID are read-only in every document view', { timeout: 120_000 }, () =>
  runShellScenario('result-derived-id', async ({ renderer, enterQuery, key, modifier, mongo, report }) => {
    const collection = mongo.db('amdm_e2e').collection('items')
    await collection.insertMany([{ _id: 'input', bucket: 'stored' }, { _id: 'stored', name: 'separate record' }])
    const queries = [
      { code: 'db.items.aggregate([{ $match: { _id: "input" } }, { $group: { _id: "$bucket", grouped: { $sum: 1 } } }])', field: 'grouped', editable: false },
      { code: 'db.items.find({ _id: "stored" })', field: 'name', editable: true }
    ]
    for (const { code, field, editable } of queries) {
      await enterQuery(code)
      await key('Enter', 'Enter', 13, modifier)
      await clickElement(renderer, 'document.querySelector(".view-switch [aria-label=Grid]")')
      await waitForExpression(renderer, `document.querySelector('[data-doc-index]')?.textContent.includes('${field}')`)
      for (const [view, row] of [['Grid', '[data-doc-index]'], ['Tree', '.kv-row'], ['Table', '.tbl-row .idx-select']]) {
        await clickElement(renderer, `document.querySelector('.view-switch [aria-label=${view}]')`)
        await waitForExpression(renderer, `!!document.querySelector('${row}')`)
        await renderer.evaluate(`document.querySelector('${row}').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 400 }))`)
        await waitForExpression(renderer, '!!document.querySelector("[role=menuitem]")')
        const labels = await renderer.evaluate("[...document.querySelectorAll('[role=menuitem] .ctx-label')].map(el => el.textContent)")
        for (const label of ['View', 'Copy', 'Export']) assert.ok(labels.includes(label), `${view}: ${label}`)
        assert.equal(labels.includes(view === 'Grid' ? 'Edit document…' : 'Edit'), editable, view)
        assert.equal(labels.includes('Delete document'), editable, view)
        await key('Escape', 'Escape', 27)
        await waitForExpression(renderer, '!document.querySelector("[role=menuitem]")')
      }
    }
    report.steps.push('checked edit, delete, view, copy and export for grouped and stored records in Grid, Tree and Table')
  }),
)
