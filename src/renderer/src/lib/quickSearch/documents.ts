import type {
  ConnectionConfig,
  ConnectionStatus,
  HistoryEntry,
  SavedQuery,
  CollectionSort
} from '@shared/types'
import type { CatalogState } from '@renderer/store/useAppStore'
import { flattenCatalog } from '@renderer/components/explorer/Explorer'
import { formatMongoHosts } from '@renderer/lib/connectionUri'
import { resultTabLabel, tabLabel, type QueryTab } from '@renderer/lib/tabs'
import i18n from '@renderer/i18n'
import { searchId, type SearchDocument } from './types'

export interface CatalogDestination {
  connectionId: string
  rowId: string
  ancestors: string[]
}

const noActions = {
  toggleNode: async () => {},
  setActiveConnection: () => {},
  browseCollection: () => {},
  inspectIndex: () => {}
}

export function catalogSearchDocuments(
  connections: ConnectionConfig[],
  statuses: Record<string, ConnectionStatus>,
  catalogs: Record<string, CatalogState>,
  sort: CollectionSort
): { documents: SearchDocument[]; destinations: Map<string, CatalogDestination> } {
  const documents: SearchDocument[] = []
  const destinations = new Map<string, CatalogDestination>()
  for (const connection of connections) {
    if (statuses[connection.id]?.state !== 'connected') continue
    const id = searchId('connections', connection.id)
    documents.push({
      id,
      group: 'connections',
      label: connection.name,
      detail: connection.useSrv
        ? `srv · ${connection.host}`
        : formatMongoHosts(connection.host, connection.port ?? 27017),
      connectionId: connection.id
    })
    destinations.set(id, { connectionId: connection.id, rowId: connection.id, ancestors: [] })
    const catalog = catalogs[connection.id]
    if (!catalog) continue
    const ancestors: { id: string; label: string }[] = []
    for (const row of flattenCatalog(connection.id, catalog, noActions, sort, true)) {
      ancestors.length = row.depth - 1
      // Empty-state notes are presentation, not navigable catalog resources.
      if (row.icon) {
        const id = searchId('connections', row.id)
        documents.push({
          id,
          group: 'connections',
          label: row.label,
          icon: row.icon,
          detail: [connection.name, ...ancestors.map((item) => item.label)].join(' / '),
          connectionId: connection.id
        })
        destinations.set(id, {
          connectionId: connection.id,
          rowId: row.id,
          ancestors: ancestors.map((item) => item.id)
        })
      }
      ancestors.push({ id: row.id, label: row.label })
    }
  }
  return { documents, destinations }
}

export function tabSearchDocuments(tabs: QueryTab[], connections: ConnectionConfig[]): SearchDocument[] {
  const names = new Map(connections.map((connection) => [connection.id, connection.name]))
  return tabs.flatMap((tab, index) => {
    const label = tabLabel(tab, index)
    const documents: SearchDocument[] = [
      {
        id: searchId('queries', tab.id),
        group: 'queries',
        label,
        detail: [names.get(tab.connectionId ?? '') ?? tab.connectionId, tab.activeDatabase]
          .filter(Boolean)
          .join(' / '),
        code: tab.code,
        connectionId: tab.connectionId ?? undefined
      }
    ]
    for (const result of tab.results) {
      const connectionId = result.query?.connectionId ?? tab.connectionId ?? undefined
      const consoleOnly =
        result.result.kind === 'value' && result.result.data == null && !!result.result.output?.length
      const kind = consoleOnly
        ? i18n.t('result.view.console')
        : i18n.t(
            {
              documents: 'quickSearch.documents',
              value: 'result.kindValue',
              ack: 'result.kindAck',
              explain: 'result.explainTag',
              error: 'result.errorName'
            }[result.result.kind]
          )
      documents.push({
        id: searchId('data', result.id),
        group: 'data',
        label: resultTabLabel(result),
        detail: [
          names.get(connectionId ?? '') ?? connectionId,
          result.query?.database ?? tab.activeDatabase,
          label,
          kind,
          new Date(result.executedAt).toLocaleString()
        ]
          .filter(Boolean)
          .join(' / '),
        searchDetail: [
          names.get(connectionId ?? '') ?? connectionId,
          result.query?.database ?? tab.activeDatabase,
          kind
        ]
          .filter(Boolean)
          .join(' / '),
        code: result.query?.code,
        connectionId,
        updatedAt: result.executedAt
      })
    }
    return documents
  })
}

export function storedSearchDocuments(
  saved: SavedQuery[],
  history: HistoryEntry[],
  connections: ConnectionConfig[]
): SearchDocument[] {
  const names = new Map(connections.map((connection) => [connection.id, connection.name]))
  const documents: SearchDocument[] = saved.map((query) => ({
    id: searchId('saved', query.id),
    group: 'saved',
    label: query.name,
    detail: [query.folder, names.get(query.connectionId ?? '') ?? query.connectionId, query.database]
      .filter(Boolean)
      .join(' / '),
    code: query.code,
    connectionId: query.connectionId,
    updatedAt: query.updatedAt
  }))
  // Code strings remain keys; no normalized-code equivalence is introduced.
  const grouped = new Map<string, Map<string, Map<string, { newest: HistoryEntry; visits: string[] }>>>()
  for (const entry of history) {
    let databases = grouped.get(entry.connectionId)
    if (!databases) grouped.set(entry.connectionId, (databases = new Map()))
    let codes = databases.get(entry.database)
    if (!codes) databases.set(entry.database, (codes = new Map()))
    const existing = codes.get(entry.code)
    if (existing) {
      existing.visits.push(searchId('history', entry.id))
      if (entry.ranAt > existing.newest.ranAt) existing.newest = entry
    } else codes.set(entry.code, { newest: entry, visits: [searchId('history', entry.id)] })
  }
  for (const databases of grouped.values())
    for (const codes of databases.values())
      for (const { newest: entry, visits } of codes.values()) {
        // Use a member's stable id rather than storing query text in visit identifiers.
        const id = searchId('history', entry.id)
        documents.push({
          id,
          group: 'history',
          label: entry.code.slice(0, 100).replace(/\s+/g, ' ').trim(),
          detail: [
            names.get(entry.connectionId) ?? entry.connectionId,
            entry.database,
            new Date(entry.ranAt).toLocaleString(),
            entry.summary
          ]
            .filter(Boolean)
            .join(' / '),
          searchDetail: [names.get(entry.connectionId) ?? entry.connectionId, entry.database]
            .filter(Boolean)
            .join(' / '),
          code: entry.code,
          connectionId: entry.connectionId,
          updatedAt: entry.ranAt,
          count: visits.length,
          visitIds: visits
        })
      }
  return documents
}
