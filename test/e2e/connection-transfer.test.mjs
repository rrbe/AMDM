import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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

const root = resolve(import.meta.dirname, '../..')
const diagnostics = join(root, 'dist/e2e-validation/connection-transfer')
const dialog = 'document.querySelector("[role=dialog]")'
const textControl = (selector, text, scope = dialog) =>
  `Array.from((${scope})?.querySelectorAll(${JSON.stringify(selector)}) ?? []).find(el => el.innerText.trim() === ${JSON.stringify(text)})`
const button = (text) => textControl('button', text)
const checkbox = (text) => textControl('[role=checkbox]', text)
const field = (name, selector = 'input') =>
  `Array.from((${dialog})?.querySelectorAll('label') ?? []).find(el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim() === ${JSON.stringify(name)})?.querySelector(${JSON.stringify(selector)})`

const secretFields = ['password', 'sshPassword', 'sshPassphrase', 'jumpSshPassphrase']
const secrets = {
  password: 'fake-db-password-transfer-9!7',
  sshPassword: 'fake-ssh-password-transfer-8!6',
  sshPassphrase: 'fake-key-passphrase-transfer-7!5',
  jumpSshPassphrase: 'fake-jump-passphrase-transfer-6!4'
}
const passphrase = 'fake-backup-passphrase-5!3'
const fixtures = [0, 1, 2].map((index) => ({
  id: `transfer-fixture-${index}`,
  name: `Transfer fixture ${index + 1}`,
  host: `transfer-${index + 1}.example.test`,
  port: 27017,
  useSrv: false,
  auth: { type: 'scram', username: `fake-user-${index}`, authSource: 'admin' },
  ssh:
    index === 2
      ? {
          enabled: true,
          host: 'ssh-transfer.example.test',
          port: 22,
          username: 'fake-ssh-user',
          authMethod: 'privateKey',
          privateKeyPath: '/fake-transfer-keys/id_ed25519',
          jump: {
            host: 'jump-transfer.example.test',
            port: 22,
            username: 'fake-jump-user',
            authMethod: 'privateKey',
            privateKeyPath: '/fake-transfer-keys/jump_ed25519'
          }
        }
      : { enabled: false },
  tls:
    index === 2
      ? {
          enabled: true,
          caFile: '/fake-transfer-certificates/ca.pem',
          certificateKeyFile: '/fake-transfer-certificates/client.pem'
        }
      : { enabled: false }
}))

function assertSanitized(value) {
  const wire = JSON.stringify(value)
  for (const secret of [...Object.values(secrets), passphrase]) assert.ok(!wire.includes(secret))
  for (const fieldName of [
    ...secretFields,
    'encPassword',
    'encSshPassword',
    'encSshPassphrase',
    'encJumpSshPassphrase'
  ]) {
    assert.ok(!wire.includes(`"${fieldName}":`), `Secret field reached Renderer: ${fieldName}`)
  }
}

// Imports normalize omitted optional fields. Compare all fields the source actually supplied.
function assertPreserved(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === 'object') assertPreserved(actual[key], value)
    else assert.deepEqual(actual[key], value, `Import changed ${key}`)
  }
}

async function pressKey(renderer, key, code, windowsVirtualKeyCode, modifiers = 0) {
  const params = { key, code, windowsVirtualKeyCode, modifiers }
  await renderer.call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...params
  })
  await renderer.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function typeInto(renderer, expression, text) {
  await clickElement(renderer, expression)
  const modifiers = process.platform === 'darwin' ? 4 : 2
  await renderer.call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
    modifiers, commands: ['selectAll']
  })
  await renderer.call('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers
  })
  await waitForExpression(renderer, `(() => {
    const input = ${expression};
    return input === document.activeElement && input.selectionStart === 0 && input.selectionEnd === input.value.length;
  })()`)
  await renderer.call('Input.insertText', { text })
  await waitForExpression(renderer, `(${expression})?.value === ${JSON.stringify(text)}`)
}

// Native context-menu input: never dispatch synthetic DOM events or force React state.
async function rightClick(renderer, selector, position = 'center') {
  const point = await waitForExpression(
    renderer,
    `(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const point = ${position === 'bottom' ? '{ x: r.left + 12, y: r.bottom - 8 }' : position === 'heading' ? '{ x: r.left + 12, y: r.top + r.height / 2 }' : '{ x: r.left + r.width / 2, y: r.top + r.height / 2 }'};
    const hit = document.elementFromPoint(point.x, point.y);
    if (!r.width || !r.height || !el.contains(hit)) return null;
    if (${position !== 'center'} && hit.closest('[data-explorer-row], input, textarea, button')) return null;
    return point;
  })()`
  )
  // Queue the full gesture before waiting for acknowledgements so native menu
  // handling cannot block the release event on macOS.
  await Promise.all([
    {
      type: 'mouseMoved', buttons: 0, ...point
    },
    {
      type: 'mousePressed', button: 'right', buttons: 2, clickCount: 1, ...point
    },
    {
      type: 'mouseReleased', button: 'right', buttons: 0, clickCount: 1, ...point
    }
  ].map(async (event) => {
    try {
      await renderer.call('Input.dispatchMouseEvent', event)
    } catch (error) {
      throw new Error(`Right-click ${selector} ${event.type}: ${error.message}`, { cause: error })
    }
  }))
  await waitForExpression(renderer, '!!document.querySelector("[role=menu]")')
}

async function openTransfer(
  renderer,
  title,
  selector = '.explorer-body',
  position = 'bottom',
  menuScreenshot
) {
  await rightClick(renderer, selector, position)
  if (menuScreenshot) await screenshot(renderer, menuScreenshot)
  await clickElement(renderer, textControl('[role=menuitem]', title, 'document'))
  await waitForExpression(
    renderer,
    `!!${dialog} && ${dialog}.innerText.includes(${JSON.stringify(title === 'Export this connection…' ? 'Export connections' : title)})`
  )
  await waitForExpression(renderer, `${dialog}.contains(document.activeElement)`)
}

async function escapeDialog(renderer) {
  await pressKey(renderer, 'Escape', 'Escape', 27)
  await waitForExpression(renderer, `!${dialog} && !document.querySelector('[role=menu]')`)
  await renderer.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

async function chooseFormat(renderer, label) {
  const card = textControl('[role=radio]', label)
  await clickElement(renderer, card)
  await waitForExpression(
    renderer,
    `(${card})?.getAttribute('aria-checked') === 'true' && ${dialog}.querySelectorAll('[role=radio][aria-checked=true]').length === 1`
  )
}

async function reload(renderer, expectedCount, theme) {
  await renderer.call('Page.enable')
  const loads = () => renderer.events.filter((event) => event.method === 'Page.loadEventFired').length
  const previousLoads = loads()
  await renderer.call('Page.reload', { ignoreCache: true })
  // Wait outside the page: evaluating during navigation can target the destroyed context.
  const deadline = Date.now() + 15_000
  while (loads() === previousLoads) {
    assert.ok(Date.now() < deadline, 'Renderer reload timed out')
    await delay(25)
  }
  await waitForUi(renderer)
  await renderer.call('Page.bringToFront')
  // Hosted desktops may show the window without granting it native focus.
  await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await waitForExpression(
    renderer,
    `document.hasFocus() && document.visibilityState === 'visible' && document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.querySelector('.library-count')?.textContent.trim() === '· ${expectedCount}'`
  )
}

async function screenshot(renderer, name) {
  const { data } = await renderer.call('Page.captureScreenshot')
  await writeFile(join(diagnostics, `${name}.png`), Buffer.from(data, 'base64'))
}

test(
  'packaged connection transfer encrypts backups, sanitizes previews, copies safely and imports offline',
  { timeout: 120_000 },
  async () => {
    await mkdir(diagnostics, { recursive: true })
    await rm(join(diagnostics, 'failure.png'), { force: true })
    const profile = await mkdtemp(join(tmpdir(), 'amdm-connection-transfer-e2e-'))
    const backupPath = join(profile, 'fake-encrypted-backup.json')
    const clients = []
    const report = { steps: [], passed: false }
    let application, renderer, main
    let phase = 'seed isolated profile'
    const snapshot = async () => ({
      connections: await readFile(join(profile, 'connections.json'), 'utf8'),
      settings: await readFile(join(profile, 'settings.json'), 'utf8')
    })
    try {
      await writeFile(
        join(profile, 'settings.json'),
        JSON.stringify({
          version: 1,
          settings: {
            language: 'en',
            theme: 'light',
            automaticUpdateChecks: false
          }
        })
      )
      await writeFile(
        join(profile, 'connections.json'),
        JSON.stringify({
          version: 1,
          connections: fixtures.map((config) => ({
            ...config,
            createdAt: 1,
            updatedAt: 1
          }))
        })
      )
      application = await launchPackaged(root, profile)
      renderer = await DebuggerClient.connect(
        (await waitForTarget(application.rendererPort, (target) => target.type === 'page'))
          .webSocketDebuggerUrl
      )
      clients.push(renderer)
      main = await DebuggerClient.connect(
        (await waitForTarget(application.mainPort, () => true)).webSocketDebuggerUrl
      )
      clients.push(main)
      await waitForUi(renderer)
      report.processIds = await main.evaluate(`(() => {
      const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      const realpath = process.getBuiltinModule('fs').realpathSync;
      if (realpath(electron.app.getPath('userData')) !== realpath(${JSON.stringify(profile)})) throw new Error('Not the isolated E2E profile');
      globalThis.connectionTransferE2e = { copied: null, saves: 0, opens: 0, responses: [], connects: 0 };
      electron.dialog.showSaveDialog = async () => {
        connectionTransferE2e.saves++;
        return { canceled: false, filePath: ${JSON.stringify(backupPath)} };
      };
      electron.dialog.showOpenDialog = async () => {
        connectionTransferE2e.opens++;
        return { canceled: false, filePaths: [${JSON.stringify(backupPath)}] };
      };
      // Capture the clipboard boundary without touching the desktop clipboard.
      electron.clipboard.writeText = (text) => { connectionTransferE2e.copied = text };
      // Observe real UI-invoked IPC responses without changing requests or results.
      // Electron's inspector-only handler map is confined to this temporary process.
      for (const channel of ['connections:importPreview', 'connections:importApply', 'session:connect']) {
        const handler = electron.ipcMain._invokeHandlers.get(channel);
        if (!handler) throw new Error('Missing packaged IPC handler: ' + channel);
        electron.ipcMain._invokeHandlers.set(channel, async (...args) => {
          if (channel === 'session:connect') connectionTransferE2e.connects++;
          const response = await handler(...args);
          if (channel !== 'session:connect') connectionTransferE2e.responses.push({ channel, response });
          return response;
        });
      }
      // Native window activation must run outside the inspector evaluation.
      setTimeout(() => {
        const window = electron.BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
        window.webContents.setBackgroundThrottling(false);
        window.show();
        window.focus();
        window.webContents.focus();
      }, 0);
      return { main: process.pid, renderer: electron.BrowserWindow.getAllWindows()[0].webContents.getOSProcessId() };
    })()`)
      phase = 'save fake credentials through the real bridge'
      const saved =
        await renderer.evaluate(`Promise.all(${JSON.stringify(fixtures)}.map((config, index) => window.api.connections.save({
      ...config, password: ${JSON.stringify(secrets.password)}, ...(index === 2 ? ${JSON.stringify(secrets)} : {})
    })))`)
      assertSanitized(saved)
      assert.equal(saved.length, 3)
      assert.ok(saved.every((config) => config.hasPassword))
      await reload(renderer, 3, 'light')
      report.lightBackground = await renderer.evaluate(
        'getComputedStyle(document.body).backgroundColor'
      )
      const original = await snapshot()

      phase = 'copy password-free MongoDB URI list from blank Explorer menu'
      await openTransfer(
        renderer,
        'Export connections',
        '.explorer-body',
        'bottom',
        'light-blank-menu'
      )
      assert.ok(await renderer.evaluate(`${dialog}.innerText.includes('3 of 3 selected')`))
      assert.equal(
        await renderer.evaluate(
          `(${checkbox('Include stored passwords and key passphrases')}).getAttribute('aria-checked')`
        ),
        'false'
      )
      await chooseFormat(renderer, 'MongoDB URI list')
      await clickElement(renderer, button('Copy URI list'))
      const copied = await waitForExpression(main, 'connectionTransferE2e.copied')
      const urls = copied
        .trim()
        .split(/\r?\n/)
        .map((line) => new URL(line))
      assert.equal(urls.length, 3)
      assert.deepEqual(
        urls.map((url) => url.hostname).sort(),
        fixtures.map((config) => config.host).sort()
      )
      for (const url of urls) {
        assert.equal(url.protocol, 'mongodb:')
        assert.equal(url.password, '')
        assert.equal(url.searchParams.get('authSource'), 'admin')
      }
      for (const secret of Object.values(secrets)) assert.ok(!copied.includes(secret))
      await waitForExpression(
        renderer,
        `${dialog}.querySelector('[role=status]')?.innerText === 'Exported 3 connections.'`
      )
      report.steps.push(
        'blank Explorer menu copies all three valid URIs without stored passwords or desktop clipboard writes'
      )

      phase = 'save whole-payload encrypted AMDM backup'
      await chooseFormat(renderer, 'AMDM (JSON)')
      await clickElement(renderer, checkbox('Include stored passwords and key passphrases'))
      await waitForExpression(renderer, `(${button('Export connections')})?.disabled === true`)
      await typeInto(renderer, field('Passphrase'), passphrase)
      await typeInto(renderer, field('Confirm passphrase'), 'fake-mismatch')
      await waitForExpression(
        renderer,
        `${dialog}.innerText.includes('The passphrases do not match.')`
      )
      await waitForExpression(renderer, `(${button('Export connections')})?.disabled === true`)
      await typeInto(renderer, field('Confirm passphrase'), passphrase)
      await clickElement(renderer, button('Export connections'))
      await waitForExpression(
        renderer,
        `${dialog}.querySelector('[role=status]')?.innerText === 'Exported 3 connections.'`
      )
      const backup = await readFile(backupPath, 'utf8')
      const envelope = JSON.parse(backup)
      assert.equal(envelope.encrypted, true)
      assert.equal(envelope.encryption.cipher, 'aes-256-gcm')
      assert.ok(envelope.ciphertext.length > 0)
      for (const privateValue of [
        ...Object.values(secrets),
        passphrase,
        ...fixtures.flatMap((config) => [config.name, config.host]),
        fixtures[2].ssh.host,
        fixtures[2].ssh.privateKeyPath,
        fixtures[2].tls.caFile
      ]) {
        assert.ok(!backup.includes(privateValue), 'AMDM backup exposed unencrypted configuration')
      }
      assert.deepEqual(await snapshot(), original)
      await screenshot(renderer, 'light-encrypted-export')
      await escapeDialog(renderer)
      report.steps.push(
        'AMDM export requires matching passphrases and encrypts names, hosts, file paths and all credentials'
      )

      phase = 'import from heading menu; wrong passphrase cannot mutate saved data'
      await openTransfer(
        renderer,
        'Import connections',
        '.side-section-head',
        'heading',
        'light-heading-menu'
      )
      await clickElement(renderer, button('Choose file…'))
      await waitForExpression(
        renderer,
        `!!(${field('Passphrase')}) && ${dialog}.querySelector('[role=alert]')?.innerText === 'Enter the file passphrase to continue.'`
      )
      await waitForExpression(renderer, `(${button('Import 0 connections')})?.disabled === true`)
      await typeInto(renderer, field('Passphrase'), 'fake-wrong-passphrase')
      await clickElement(renderer, button('Unlock file'))
      await waitForExpression(
        renderer,
        `${dialog}.querySelector('[role=alert]')?.innerText === 'The passphrase is incorrect or the encrypted file is damaged. Try again or choose another file.'`
      )
      assert.deepEqual(await snapshot(), original)
      assert.equal((await renderer.evaluate('window.api.connections.list()')).length, 3)
      await screenshot(renderer, 'light-wrong-passphrase')

      phase = 'sanitized preview and external-file warning acknowledgement'
      await typeInto(renderer, field('Passphrase'), passphrase)
      await clickElement(renderer, button('Unlock file'))
      await waitForExpression(
        renderer,
        `!!(${checkbox('I have reviewed the warnings for the selected connections and accept the described changes.')})`
      )
      const responses = await main.evaluate('connectionTransferE2e.responses')
      assertSanitized(responses)
      const previews = responses
        .filter(({ channel }) => channel === 'connections:importPreview')
        .map(({ response }) => response)
      assert.equal(previews.length, 3)
      assert.equal(previews[1].error, 'invalidPassword')
      assert.deepEqual(previews[1].rows, [])
      const preview = previews.at(-1)
      assert.equal(preview.rows.length, 3)
      assert.ok(preview.rows.every((row) => row.config?.hasPassword && !row.error))
      const sshPreview = preview.rows.find((row) => row.name === fixtures[2].name)
      assert.ok(sshPreview.warnings.includes('externalFiles'))
      assert.equal(sshPreview.config.hasSshPassword, true)
      assert.equal(sshPreview.config.hasSshPassphrase, true)
      assert.equal(sshPreview.config.hasJumpSshPassphrase, true)
      const dom = await renderer.evaluate('document.documentElement.outerHTML')
      for (const secret of [...Object.values(secrets), passphrase]) assert.ok(!dom.includes(secret))
      await waitForExpression(renderer, `(${button('Import 3 connections')})?.disabled === true`)
      assert.deepEqual(await snapshot(), original)
      await screenshot(renderer, 'light-sanitized-preview')
      await clickElement(
        renderer,
        checkbox(
          'I have reviewed the warnings for the selected connections and accept the described changes.'
        )
      )
      await clickElement(renderer, button('Import 3 connections'))
      await waitForExpression(
        renderer,
        `${dialog}.querySelector('[role=status]')?.innerText.includes('Created 3 new connections; replaced 0 existing connections.')`
      )
      const imported = await renderer.evaluate('window.api.connections.list()')
      assertSanitized(imported)
      assert.equal(imported.length, 6)
      assert.equal(new Set(imported.map((config) => config.id)).size, 6)
      for (const fixture of fixtures) {
        const source = imported.find((config) => config.id === fixture.id)
        const copy = imported.find((config) => config.name === `${fixture.name} (2)`)
        assert.ok(copy, `Missing uniquely named copy of ${fixture.name}`)
        const { id, name, ...configuration } = fixture
        assertPreserved(copy, configuration)
        for (const key of [
          'hasPassword',
          'hasSshPassword',
          'hasSshPassphrase',
          'hasJumpSshPassphrase'
        ]) {
          assert.deepEqual(copy[key], source[key], `Import changed ${key}`)
        }
      }
      assertSanitized(await main.evaluate('connectionTransferE2e.responses'))
      await escapeDialog(renderer)
      report.steps.push(
        'wrong passphrase leaves files unchanged; sanitized preview gates import on warnings; copies retain secret flags and receive (2) suffixes'
      )

      phase = 'single-row selection and filtered-out batch export'
      await openTransfer(
        renderer,
        'Export this connection…',
        '.conn-item',
        'center',
        'light-row-menu'
      )
      await waitForExpression(renderer, `${dialog}.innerText.includes('1 of 6 selected')`)
      assert.equal(
        await renderer.evaluate(
          `${dialog}.querySelectorAll('[role=checkbox][aria-checked=true]').length`
        ),
        1
      )
      await screenshot(renderer, 'light-single-connection')
      await escapeDialog(renderer)
      await clickElement(renderer, 'document.querySelector(".side-search-toggle")')
      await typeInto(
        renderer,
        'document.querySelector(".explorer-search input")',
        'no-matching-transfer-fixtures'
      )
      await waitForExpression(
        renderer,
        '!document.querySelector(".conn-item") && document.querySelector(".explorer-empty")?.innerText === "No matching loaded items."'
      )
      await openTransfer(renderer, 'Export connections')
      await waitForExpression(renderer, `${dialog}.innerText.includes('6 of 6 selected')`)
      await chooseFormat(renderer, 'MongoDB URI list')
      await clickElement(renderer, button('Copy URI list'))
      await waitForExpression(
        renderer,
        `${dialog}.querySelector('[role=status]')?.innerText === 'Exported 6 connections.'`
      )
      const filteredUrls = (await main.evaluate('connectionTransferE2e.copied'))
        .trim()
        .split(/\r?\n/)
        .map((line) => new URL(line))
      assert.equal(filteredUrls.length, 6)
      assert.deepEqual(
        filteredUrls.map((url) => url.hostname).sort(),
        fixtures.flatMap((config) => [config.host, config.host]).sort()
      )
      assert.ok(filteredUrls.every((url) => url.protocol === 'mongodb:' && url.password === ''))
      await screenshot(renderer, 'light-filtered-batch')
      await escapeDialog(renderer)
      report.steps.push(
        'row menu preselects exactly one; an empty Explorer search result still batch-selects all six saved connections'
      )

      phase = 'persisted dark theme, native menu and keyboard focus containment'
      await renderer.evaluate('window.api.settings.update({ theme: "dark" })')
      await reload(renderer, 6, 'dark')
      // The theme attribute can change before Chromium updates the rendered colors.
      await waitForExpression(
        renderer,
        `getComputedStyle(document.body).backgroundColor !== ${JSON.stringify(report.lightBackground)}`
      )
      const background = await renderer.evaluate('getComputedStyle(document.body).backgroundColor')
      assert.notEqual(
        background,
        report.lightBackground,
        'Theme changed its name without changing rendered colors'
      )
      await openTransfer(
        renderer,
        'Export connections',
        '.side-section-head',
        'heading',
        'dark-heading-menu'
      )
      await waitForExpression(
        renderer,
        `document.activeElement?.getAttribute('role') === 'radio' && ${dialog}.contains(document.activeElement)`
      )
      for (const modifiers of [0, 1]) {
        for (let index = 0; index < 10; index++) {
          await pressKey(renderer, 'Tab', 'Tab', 9, modifiers)
          // Base UI redirects its focus guards after the native Tab event.
          await renderer.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          assert.ok(
            await renderer.evaluate(`${dialog}.contains(document.activeElement)`),
            'Tab escaped the transfer dialog'
          )
        }
      }
      await screenshot(renderer, 'dark-keyboard-focus')
      await escapeDialog(renderer)
      report.darkBackground = background
      report.steps.push(
        'theme survives reload; heading menu works in dark mode; Tab/Shift+Tab stay inside the modal and Escape closes it'
      )

      phase = 'bounded mounted list with 200 additional saved configurations'
      await renderer.evaluate(`(async () => {
      for (let index = 0; index < 200; index++) await window.api.connections.save({
        id: 'transfer-bulk-' + index, name: 'Transfer bulk ' + String(index).padStart(3, '0'),
        host: 'bulk-' + index + '.example.test', useSrv: false,
        auth: { type: 'none' }, ssh: { enabled: false }, tls: { enabled: false }
      });
      return true;
    })()`)
      await reload(renderer, 206, 'dark')
      await openTransfer(renderer, 'Export connections', '.side-section-head', 'heading')
      await waitForExpression(
        renderer,
        `${dialog}.innerText.includes('206 of 206 selected') && ${dialog}.querySelectorAll('[data-index]').length > 0`
      )
      const mounted = await renderer.evaluate(`${dialog}.querySelectorAll('[data-index]').length`)
      assert.ok(mounted < 40, `Export mounted ${mounted} rows for 206 saved connections`)
      await clickElement(renderer, button('Deselect all'))
      await waitForExpression(renderer, `${dialog}.innerText.includes('0 of 206 selected')`)
      await waitForExpression(renderer, `(${button('Export connections')})?.disabled === true`)
      await clickElement(renderer, button('Select all'))
      await waitForExpression(renderer, `${dialog}.innerText.includes('206 of 206 selected')`)
      const scrollPoint = await waitForExpression(renderer, `(async () => {
      const list = ${dialog}.querySelector('[data-index]').closest('.overflow-y-auto');
      list.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = list.getBoundingClientRect();
      const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      return list.contains(document.elementFromPoint(point.x, point.y)) ? point : null;
    })()`)
      await renderer.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...scrollPoint
      })
      await renderer.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        deltaX: 0,
        deltaY: 30_000,
        ...scrollPoint
      })
      await waitForExpression(renderer, `${dialog}.innerText.includes('Transfer bulk 199')`)
      assert.ok(await renderer.evaluate(`${dialog}.querySelectorAll('[data-index]').length < 40`))
      await screenshot(renderer, 'dark-virtualized-list-end')
      await escapeDialog(renderer)
      report.mountedExportRows = mounted
      report.steps.push(
        '206 saved connections mount fewer than 40 transfer rows; select-all includes offscreen rows and native scrolling reaches the final row'
      )

      const boundaries = await main.evaluate(
        '({ saves: connectionTransferE2e.saves, opens: connectionTransferE2e.opens, connects: connectionTransferE2e.connects })'
      )
      assert.deepEqual(boundaries, { saves: 1, opens: 1, connects: 0 })
      report.boundaries = boundaries
      assertRuntimeHealthy(clients, application)
      await quitPackaged(application, main, clients)
      report.passed = true
    } catch (error) {
      report.phase = phase
      report.error = error.stack
      if (process.platform === 'darwin' && /Debugger timeout: Input/.test(error.message)) {
        report.samples = {}
        for (const [name, pid] of Object.entries(report.processIds)) {
          const sample = spawnSync('sample', [String(pid), '1', '-file', join(diagnostics, `${name}-hang.sample`)], { timeout: 5_000, encoding: 'utf8' })
          report.samples[name] = { status: sample.status, error: sample.error?.message }
        }
      }
      if (renderer) {
        await screenshot(renderer, 'failure').catch(() => undefined)
        report.dom = await renderer.evaluate('document.body.innerText').catch(() => undefined)
        report.focus = await renderer
          .evaluate(
            '({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute("role"), label: document.activeElement?.getAttribute("aria-label") })'
          )
          .catch(() => undefined)
      }
      throw error
    } finally {
      for (const client of clients) client.close()
      await application?.stop()
      await writeFile(join(diagnostics, 'electron.log'), application?.logs ?? '')
      await writeFile(join(diagnostics, 'report.json'), JSON.stringify(report, null, 2))
      await rm(profile, { recursive: true, force: true })
    }
  }
)
