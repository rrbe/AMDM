import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SchemaModel } from '../../../src/shared/types'
import { schemaPanelKey } from '../../../src/renderer/src/lib/schemaPanel'
import { useAppStore } from '../../../src/renderer/src/store/useAppStore'

const target = { connectionId: 'c1', database: 'shop', collection: 'orders' }
const other = { ...target, collection: 'customers' }
const model = (analyzedAt: number): SchemaModel => ({
  target,
  analysis: {
    analyzedAt,
    sampleSize: 50,
    fields: [],
    generated: { bsonType: 'object' }
  },
  draft: { bsonType: 'object' },
  draftUpdatedAt: analyzedAt
})

describe('shared Schema sidebar state', () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))
  afterEach(() => vi.unstubAllGlobals())

  it('loads only the local snapshot and retains view state when analysis changes', async () => {
    const get = vi.fn().mockResolvedValue(model(1))
    const analyze = vi.fn().mockResolvedValue(model(2))
    vi.stubGlobal('window', { api: { schemas: { get, analyze } } })
    await useAppStore.getState().loadSchemaModel(target)
    await useAppStore.getState().loadSchemaModel(target)
    expect(get).toHaveBeenCalledTimes(1)
    expect(analyze).not.toHaveBeenCalled()
    useAppStore.getState().updateSchemaPanel(target, {
      search: 'name',
      expanded: new Set(['profile']),
      scrollTop: 250
    })
    await useAppStore.getState().analyzeSchema(target)
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(target)]).toMatchObject({
      model: model(2),
      search: 'name',
      scrollTop: 250,
      analyzing: false
    })
  })

  it('does not analyze a missing local snapshot', async () => {
    const analyze = vi.fn()
    vi.stubGlobal('window', {
      api: { schemas: { get: vi.fn().mockResolvedValue(null), analyze } }
    })
    expect(await useAppStore.getState().loadSchemaModel(target)).toBeNull()
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(target)].model).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('does not overwrite a refreshed analysis with a late local snapshot', async () => {
    let resolve!: (value: SchemaModel) => void
    vi.stubGlobal('window', {
      api: {
        schemas: {
          get: () =>
            new Promise<SchemaModel>((done) => {
              resolve = done
            }),
          analyze: vi.fn().mockResolvedValue(model(2))
        }
      }
    })
    const loading = useAppStore.getState().loadSchemaModel(target)
    await useAppStore.getState().analyzeSchema(target)
    resolve(model(1))
    expect(await loading).toEqual(model(2))
  })

  it('keeps results owned by their namespace and suppresses duplicate analysis requests', async () => {
    let resolve!: (value: SchemaModel) => void
    const analyze = vi.fn(
      () =>
        new Promise<SchemaModel>((done) => {
          resolve = done
        })
    )
    vi.stubGlobal('window', { api: { schemas: { analyze } } })
    const pending = useAppStore.getState().analyzeSchema(target)
    const duplicate = useAppStore.getState().analyzeSchema(target)
    await Promise.resolve()
    expect(analyze).toHaveBeenCalledTimes(1)
    useAppStore.getState().updateSchemaPanel(other, { search: 'email' })
    resolve(model(2))
    expect(await pending).toEqual(model(2))
    expect(await duplicate).toEqual(model(2))
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(other)].model).toBeUndefined()
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(other)].search).toBe('email')
  })

  it('releases connection state and rejects late analysis after reconnect creates a new owner', async () => {
    let resolve!: (value: SchemaModel) => void
    vi.stubGlobal('window', {
      api: {
        schemas: {
          analyze: () =>
            new Promise<SchemaModel>((done) => {
              resolve = done
            })
        },
        session: { disconnect: vi.fn().mockResolvedValue(undefined) }
      }
    })
    const pending = useAppStore.getState().analyzeSchema(target)
    await Promise.resolve()
    await useAppStore.getState().disconnect('c1')
    expect(useAppStore.getState().schemaPanels).toEqual({})
    useAppStore.getState().updateSchemaPanel(target, { search: 'new session' })
    resolve(model(2))
    expect(await pending).toBeNull()
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(target)].model).toBeUndefined()
    expect(useAppStore.getState().notifications).toEqual([])
  })

  it('keeps the last snapshot on refresh failure and exposes the error once', async () => {
    vi.stubGlobal('window', {
      api: {
        schemas: {
          get: vi.fn().mockResolvedValue(model(1)),
          analyze: vi.fn().mockRejectedValue(new Error('not authorized'))
        }
      }
    })
    await useAppStore.getState().loadSchemaModel(target)
    await useAppStore.getState().analyzeSchema(target)
    expect(useAppStore.getState().schemaPanels[schemaPanelKey(target)]).toMatchObject({
      model: model(1),
      analyzing: false,
      error: 'not authorized'
    })
    expect(useAppStore.getState().notifications).toHaveLength(1)
  })
})
