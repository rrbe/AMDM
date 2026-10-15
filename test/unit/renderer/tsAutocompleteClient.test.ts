import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TsWorkerRequest, TsWorkerResponse } from '@renderer/lib/tsAutocomplete/protocol'

class FakeWorker {
  static current: FakeWorker
  messages: TsWorkerRequest[] = []
  onmessage: ((event: { data: TsWorkerResponse }) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() {
    FakeWorker.current = this
  }
  postMessage(message: TsWorkerRequest): void {
    this.messages.push(message)
  }
  reply(message: TsWorkerResponse): void {
    this.onmessage?.({ data: message })
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared completion and diagnostics worker client', () => {
  it('routes simultaneous replies independently and passes the catalog snapshot', async () => {
    const { tsAutocomplete: client } =
      await import('@renderer/lib/tsAutocomplete/tsAutocompleteClient')
    const completion = client.complete('db.', 3)
    const context = { database: 'app', collections: ['users'] }
    const diagnostics = client.diagnose('db.usres.find()', context)
    const worker = FakeWorker.current
    expect(worker.messages).toEqual([
      { type: 'init' },
      { type: 'complete', seq: 1, code: 'db.', pos: 3 },
      { type: 'diagnose', seq: 2, code: 'db.usres.find()', context }
    ])
    const problems = [
      { from: 3, to: 8, severity: 'warning' as const, message: 'Unknown collection' }
    ]
    worker.reply({ type: 'diagnostics', seq: 2, diagnostics: problems })
    worker.reply({
      type: 'result',
      seq: 1,
      entries: [{ name: 'users', kind: 'property', sortText: '0' }]
    })
    expect(await diagnostics).toEqual(problems)
    expect(await completion).toMatchObject({ entries: [{ name: 'users' }] })
  })

  it('does not cancel diagnostics when completion aborts during typing', async () => {
    const { tsAutocomplete: client } =
      await import('@renderer/lib/tsAutocomplete/tsAutocompleteClient')
    const completion = client.complete('db.', 3)
    const diagnostics = client.diagnose('db.users.find()', { database: 'app', collections: null })
    client.cancel()
    expect(await completion).toBeNull()
    FakeWorker.current.reply({ type: 'diagnostics', seq: 2, diagnostics: [] })
    expect(await diagnostics).toEqual([])
  })

  it('times out analysis and ignores its late reply without breaking later requests', async () => {
    const { tsAutocomplete: client } =
      await import('@renderer/lib/tsAutocomplete/tsAutocompleteClient')
    const first = client.diagnose('db.users.fidn()', { database: 'app', collections: null })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await first).toBeNull()
    const second = client.diagnose('db.users.find()', { database: 'app', collections: null })
    FakeWorker.current.reply({
      type: 'diagnostics',
      seq: 1,
      diagnostics: [{ from: 9, to: 13, severity: 'error', message: 'Stale result' }]
    })
    FakeWorker.current.reply({ type: 'diagnostics', seq: 2, diagnostics: [] })
    expect(await second).toEqual([])
  })

  it('settles both request types when the worker fails', async () => {
    const { tsAutocomplete: client } =
      await import('@renderer/lib/tsAutocomplete/tsAutocompleteClient')
    const completion = client.complete('db.', 3)
    const diagnostics = client.diagnose('db.users.find()', { database: 'app', collections: [] })
    FakeWorker.current.onerror?.()
    expect(await completion).toBeNull()
    expect(await diagnostics).toBeNull()
    expect(client.isAvailable()).toBe(false)
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce()
  })
})
