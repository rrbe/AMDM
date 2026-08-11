import type { Api } from '@shared/ipc'

interface RpcResponse<T> {
  ok: boolean
  result?: T
  error?: string
}

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  const body = (await response.json()) as RpcResponse<T>
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Request failed (${response.status}).`)
  return body.result as T
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error('This feature is unavailable on AMDM Web.'))
}

export const webApi: Api = {
  app: {
    openSettings: async () => {
      if (window.location.hash === '#settings') return
      window.history.pushState({ ...window.history.state, amdmRoute: 'settings' }, '', '#settings')
      window.dispatchEvent(new Event('popstate'))
    }
  },
  connections: {
    list: () => rpc('connections.list'),
    save: (input) => rpc('connections.save', input),
    delete: (id) => rpc('connections.delete', id),
    test: (input) => rpc('connections.test', input),
    diagnose: unavailable,
    buildUri: (input, opts) => rpc('connections.buildUri', input, opts)
  },
  session: {
    connect: (id) => rpc('session.connect', id),
    disconnect: (id) => rpc('session.disconnect', id),
    status: (id) => rpc('session.status', id)
  },
  catalog: {
    databases: (id) => rpc('catalog.databases', id),
    collections: (id, database) => rpc('catalog.collections', id, database),
    collectionCount: (id, database, collection) => rpc('catalog.collectionCount', id, database, collection),
    indexes: (id, database, collection) => rpc('catalog.indexes', id, database, collection),
    users: (id, database) => rpc('catalog.users', id, database),
    sampleFields: (id, database, collection) => rpc('catalog.sampleFields', id, database, collection)
  },
  schemas: {
    get: unavailable,
    analyze: unavailable,
    saveDraft: unavailable,
    overwriteDraft: unavailable
  },
  shell: {
    execute: (request) => rpc('shell.execute', request),
    abort: (execId) => rpc('shell.abort', execId)
  },
  queries: {
    list: () => rpc('queries.list'),
    save: (input) => rpc('queries.save', input),
    delete: (id) => rpc('queries.delete', id)
  },
  history: {
    list: () => rpc('history.list'),
    clear: () => rpc('history.clear')
  },
  docs: {
    update: (request) => rpc('docs.update', request),
    setField: (request) => rpc('docs.setField', request),
    delete: (request) => rpc('docs.delete', request)
  },
  io: {
    export: unavailable,
    import: unavailable
  },
  settings: {
    get: () => rpc('settings.get'),
    update: (patch) => rpc('settings.update', patch)
  },
  updates: {
    checkForUpdates: async () => false
  },
  dialog: {
    openFile: unavailable
  }
}
