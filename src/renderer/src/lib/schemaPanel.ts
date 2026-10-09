import type { SchemaFieldStat, SchemaModel, SchemaTarget, SchemaTypeStat } from '@shared/types'
import { tabCollection, type QueryTab } from './tabs'
import { DATABASE_RESERVED } from './tsAutocomplete/mongoBaseDts'

export const MAX_SCHEMA_PANELS = 24

export interface SchemaPanelState {
  target: SchemaTarget
  /** Keeps late requests from repopulating a released connection's cache. */
  owner: object
  model?: SchemaModel | null
  analyzing: boolean
  analysisRequest?: Promise<SchemaModel | null>
  error: string | null
  search: string
  expanded: Set<string>
  scrollTop: number
}

export function schemaPanelKey(target: SchemaTarget): string {
  return JSON.stringify([target.connectionId, target.database, target.collection])
}

export function patchSchemaPanel(
  panels: Record<string, SchemaPanelState>,
  target: SchemaTarget,
  patch: Partial<SchemaPanelState>
): Record<string, SchemaPanelState> {
  const key = schemaPanelKey(target)
  const next = { ...panels }
  const previous = next[key]
  delete next[key]
  const initial: SchemaPanelState = {
    target,
    owner: {},
    analyzing: false,
    error: null,
    search: '',
    expanded: new Set(),
    scrollTop: 0
  }
  next[key] = { ...(previous ?? initial), ...patch }
  const keys = Object.keys(next)
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SCHEMA_PANELS))) delete next[old]
  return next
}

export function releaseSchemaPanels(
  panels: Record<string, SchemaPanelState>,
  connectionId: string
): Record<string, SchemaPanelState> {
  return Object.fromEntries(Object.entries(panels).filter(([, panel]) => panel.target.connectionId !== connectionId))
}

/** Schema follows the editor namespace; an older result must not choose a different collection. */
export function schemaPanelTarget(tab: QueryTab): SchemaTarget | null {
  const collections = new Set<string>()
  // Skip quoted text and comments before looking for the same db forms used by the workspace.
  const references = tab.code.matchAll(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\bdb\s*(?:\.\s*getCollection\(\s*['"]([^'"]+)['"]\s*\)|\[\s*['"]([^'"]+)['"]\s*\]|\.\s*([A-Za-z_$][\w$]*))/g
  )
  for (const reference of references) {
    if (!reference[1] && !reference[2] && !reference[3]) continue
    if (reference[3] === 'getSiblingDB') return null
    if (reference[3] && DATABASE_RESERVED.has(reference[3])) continue
    const collection = tabCollection({ ...tab, code: reference[0] })
    if (collection) collections.add(collection)
  }
  const collection = collections.size === 1 ? [...collections][0] : null
  if (!tab.connectionId || !tab.activeDatabase || !collection) return null
  return {
    connectionId: tab.connectionId,
    database: tab.activeDatabase,
    collection
  }
}

export interface SchemaTreeNode {
  kind: 'field' | 'type'
  id: string
  path: string
  name: string
  types: SchemaTypeStat[]
  probability: number
  count: number
  scope: 'documents' | 'objects' | 'elements'
  children: SchemaTreeNode[]
}

export interface SchemaTreeRow extends SchemaTreeNode {
  depth: number
}

export function schemaNodeLabel(node: SchemaTreeNode): string {
  if (node.kind === 'type') {
    if (node.types[0].bsonType === 'Document') return '{...}'
    if (node.types[0].bsonType === 'Array') return '[...]'
  }
  return node.name
}

/** The analyzer uses this capitalized sentinel for absent fields, separately from BSON undefined. */
export function observedSchemaTypes(types: SchemaTypeStat[]): SchemaTypeStat[] {
  return types.filter((type) => type.bsonType !== 'Undefined')
}

function typeChildren(
  types: SchemaTypeStat[],
  id: string,
  path: string,
  scope: SchemaTreeNode['scope']
): SchemaTreeNode[] {
  const observed = observedSchemaTypes(types)
  return observed.flatMap((type) => {
    if (type.fields) {
      const children = buildSchemaTree(type.fields, 'objects', `${id}/${type.bsonType}`, path)
      return observed.length === 1
        ? children
        : [
            {
              kind: 'type' as const,
              id: `${id}/${type.bsonType}`,
              path,
              name: type.name,
              types: [type],
              probability: type.probability,
              count: type.count,
              scope,
              children
            }
          ]
    }
    if (type.types) {
      return type.types.map((item) => ({
        kind: 'type' as const,
        id: `${id}/${type.bsonType}/${item.bsonType}`,
        path: `${path}[]`,
        name: item.name,
        types: [item],
        probability: item.probability,
        count: item.count,
        scope: 'elements' as const,
        children: typeChildren([item], `${id}/${type.bsonType}/${item.bsonType}`, `${path}[]`, 'elements')
      }))
    }
    return []
  })
}

export function buildSchemaTree(
  fields: SchemaFieldStat[],
  scope: SchemaTreeNode['scope'] = 'documents',
  parentId = '',
  parentPath = ''
): SchemaTreeNode[] {
  return fields.map((field) => {
    const id = `${parentId}/${JSON.stringify(field.name)}`
    const path = parentPath ? `${parentPath}.${field.name}` : field.name
    return {
      kind: 'field',
      id,
      path,
      name: field.name,
      types: observedSchemaTypes(field.types),
      probability: field.probability,
      count: field.count,
      scope,
      children: typeChildren(field.types, id, path, scope)
    }
  })
}

/** Search reveals matching descendants and their ancestors without mutating manual expansion. */
export function visibleSchemaRows(nodes: SchemaTreeNode[], expanded: Set<string>, search: string): SchemaTreeRow[] {
  const query = search.trim().toLocaleLowerCase()
  const rows: SchemaTreeRow[] = []
  const visit = (node: SchemaTreeNode, depth: number, ancestorMatches: boolean): SchemaTreeRow[] => {
    const matches =
      ancestorMatches ||
      (query.length > 0 &&
        `${node.path} ${node.name} ${node.types.map((type) => type.name).join(' ')}`
          .toLocaleLowerCase()
          .includes(query))
    const children =
      query || expanded.has(node.id) ? node.children.flatMap((child) => visit(child, depth + 1, matches)) : []
    if (query && !matches && children.length === 0) return []
    return [{ ...node, depth }, ...children]
  }
  for (const node of nodes) rows.push(...visit(node, 0, false))
  return rows
}
