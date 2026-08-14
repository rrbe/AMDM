import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  HistoryView,
  SavedQueriesView
} from '../../../src/renderer/src/components/explorer/SavedQueriesPanel'

const testStore = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

vi.mock('@renderer/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown): unknown =>
    selector(testStore.state)
}))

const connection = {
  id: 'c1',
  name: 'local',
  useSrv: false,
  host: 'localhost',
  port: 27017,
  auth: { type: 'none' as const },
  ssh: { enabled: false },
  tls: { enabled: false },
  createdAt: 1,
  updatedAt: 1
}

describe('saved query previews', () => {
  const code = "db.addresses.find({ active: true, score: { $gte: 10 }, name: 'Ada' })"

  function seedStoredQueries(): void {
    testStore.state = {
      savedQueries: [
        {
          id: 'saved-1',
          name: 'active addresses',
          code,
          connectionId: 'c1',
          database: 'ezze',
          createdAt: 1,
          updatedAt: 1
        }
      ],
      history: [
        {
          id: 'history-1',
          code,
          connectionId: 'c1',
          database: 'ezze',
          ranAt: Date.now(),
          ok: true,
          summary: '1 docs · 8ms'
        }
      ],
      connections: [connection],
      deleteQuery: vi.fn(),
      saveQuery: vi.fn(),
      clearHistory: vi.fn()
    }
  }

  function expectSyntaxHighlighting(markup: string): void {
    expect(markup).toContain('class="syntax-variable">db</span>')
    expect(markup).toContain('class="syntax-property">addresses</span>')
    expect(markup).toContain('class="syntax-function">find</span>')
    expect(markup).toContain('class="syntax-keyword">true</span>')
    expect(markup).toContain('class="syntax-number">10</span>')
    expect(markup).toContain('class="syntax-string">&#x27;Ada&#x27;</span>')
  }

  it('syntax-highlights saved query code without mounting an editor', () => {
    seedStoredQueries()

    expectSyntaxHighlighting(
      renderToStaticMarkup(createElement(SavedQueriesView, { onLoad: vi.fn() }))
    )
  })

  it('uses the same syntax highlighting for query history', () => {
    seedStoredQueries()

    expectSyntaxHighlighting(renderToStaticMarkup(createElement(HistoryView, { onLoad: vi.fn() })))
  })
})
