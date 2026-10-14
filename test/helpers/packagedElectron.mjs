import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function packagedExecutable(root) {
  const suffix = process.arch === 'x64' ? '' : `-${process.arch}`
  const executable = {
    darwin: join(root, 'dist', `mac${suffix}`, 'AMDM.app', 'Contents', 'MacOS', 'AMDM'),
    win32: join(root, 'dist', `win${suffix}-unpacked`, 'AMDM.exe'),
    linux: join(root, 'dist', `linux${suffix}-unpacked`, 'amdm'),
  }[process.platform]
  assert.ok(executable, `Unsupported platform: ${process.platform}`)
  return executable
}

export class DebuggerClient {
  sequence = 0
  pending = new Map()
  events = []

  static async connect(url) {
    const client = new DebuggerClient()
    client.socket = new WebSocket(url)
    await once(client.socket, 'open', { signal: AbortSignal.timeout(10_000) })
    client.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) {
        client.events.push(message)
        return
      }
      const pending = client.pending.get(message.id)
      if (!pending) return
      client.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
    client.socket.addEventListener('close', () => client.rejectPending())
    await client.call('Runtime.enable')
    return client
  }

  call(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Debugger disconnected'))
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Debugger timeout: ${method}`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }

  close() {
    this.socket.close()
    this.rejectPending()
  }

  rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Debugger closed'))
    }
    this.pending.clear()
  }
}

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function launchPackaged(root, profile, executable = packagedExecutable(root)) {
  await access(executable)
  const [rendererPort, mainPort] = await Promise.all([freePort(), freePort()])
  const environment = { ...process.env }
  // Empty ELECTRON_RUN_AS_NODE also enables Node mode on Windows.
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_RENDERER_URL',
    'NODE_COMPILE_CACHE',
    'NODE_DISABLE_COMPILE_CACHE',
  ]) {
    delete environment[name]
  }
  const startedAt = performance.now()
  const application = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${rendererPort}`,
      `--inspect=${mainPort}`,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let logs = ''
  application.stdout.on('data', (data) => {
    logs += data
  })
  application.stderr.on('data', (data) => {
    logs += data
  })
  const exit = new Promise((resolve) => {
    application.once('exit', (code, signal) => resolve({ code, signal }))
    application.once('error', (error) => {
      logs += `${error.stack}\n`
      resolve({ error: error.message })
    })
  })
  async function waitForExit(timeoutMs) {
    const controller = new AbortController()
    try {
      return await Promise.race([exit, delay(timeoutMs, undefined, { signal: controller.signal })])
    } finally {
      controller.abort()
    }
  }
  return {
    root,
    rendererPort,
    mainPort,
    startedAt,
    get logs() {
      return logs
    },
    waitForExit,
    async stop() {
      if (application.exitCode !== null || application.signalCode !== null || !application.pid)
        return
      application.kill('SIGTERM')
      if (!(await waitForExit(5000))) {
        application.kill('SIGKILL')
        assert.ok(await waitForExit(5000), 'Packaged Electron did not stop')
      }
    },
  }
}

export async function waitForTarget(port, predicate) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    let targets
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        })
      ).json()
    } catch {
      // The debugger is not listening yet while Electron starts.
    }
    const target = targets?.find(predicate)
    if (target) return target
    await delay(25)
  }
  throw new Error(`Electron debugger target missing on port ${port}`)
}

export async function waitForExpression(client, expression) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const result = await client.evaluate(expression)
    if (result) return result
    await delay(25)
  }
  throw new Error(`Renderer condition timed out: ${expression}`)
}

export function waitForUi(client) {
  return waitForExpression(client, '!!window.api && !!document.querySelector("button")')
}

// Send input through Electron's real Renderer, retaining event/focus behavior.
export async function clickElement(client, expression, clickCount = 1) {
  for (let count = 1; count <= clickCount; count++) {
    const point = await waitForExpression(
      client,
      `(async () => {
    const element = ${expression};
    if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return null;
    element.scrollIntoView({block:'nearest', inline:'nearest'});
    // Scrolling can update virtualized rows before native input arrives.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const target = ${expression};
    if (!target) return null;
    const r = target.getBoundingClientRect();
    const point = {x:r.x+r.width/2, y:r.y+r.height/2};
    return r.width && r.height && target.contains(document.elementFromPoint(point.x, point.y)) ? point : null;
  })()`,
    )
    await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await client.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: count,
      ...point,
    })
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: count,
      ...point,
    })
  }
}

export function assertRuntimeHealthy(clients, application) {
  assert.deepEqual(
    clients
      .flatMap((client) => client.events)
      .filter((event) => event.method === 'Runtime.exceptionThrown'),
    [],
  )
  assert.doesNotMatch(
    application.logs,
    /App threw an error|failed to load updater|failed to start updater|native addon not found/,
  )
}

export async function quitPackaged(application, main, clients) {
  await main.evaluate(`setTimeout(() => process.getBuiltinModule('module')
    .createRequire(${JSON.stringify(join(application.root, 'package.json'))})('electron').app.quit(), 50); true`)
  // An attached Node inspector keeps application shutdown waiting to disconnect.
  for (const client of clients) client.close()
  const exit = await application.waitForExit(5000)
  assert.ok(exit, 'Packaged Electron did not quit normally')
  assert.equal(exit.code, 0, JSON.stringify(exit))
}
