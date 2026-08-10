import type { JsonValue, MongoJsonSchema } from '@shared/types'

export const BSON_TYPES = [
  'object',
  'array',
  'string',
  'bool',
  'double',
  'int',
  'long',
  'decimal',
  'objectId',
  'date',
  'timestamp',
  'binData',
  'undefined',
  'dbPointer',
  'symbol',
  'regex',
  'javascript',
  'javascriptWithScope',
  'null',
  'minKey',
  'maxKey'
] as const

export type SchemaPathSegment = { kind: 'property'; name: string } | { kind: 'items' }

export interface FlatSchemaNode {
  id: string
  path: SchemaPathSegment[]
  parentPath: SchemaPathSegment[]
  kind: 'property' | 'items'
  name: string
  depth: number
  schema: MongoJsonSchema
  required: boolean
}

export function isSchemaObject(value: unknown): value is MongoJsonSchema {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function propertiesOf(schema: MongoJsonSchema): Record<string, MongoJsonSchema> {
  if (!isSchemaObject(schema.properties)) return {}
  return Object.fromEntries(
    Object.entries(schema.properties).filter((entry): entry is [string, MongoJsonSchema] => isSchemaObject(entry[1]))
  )
}

function requiredOf(schema: MongoJsonSchema): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : []
}

export function bsonTypesOf(schema: MongoJsonSchema): string[] {
  if (typeof schema.bsonType === 'string') return [schema.bsonType]
  if (Array.isArray(schema.bsonType)) {
    return schema.bsonType.filter((type): type is string => typeof type === 'string')
  }
  return []
}

export function hasAdvancedRules(schema: MongoJsonSchema): boolean {
  const common = new Set(['bsonType', 'description', 'properties', 'required', 'items', 'title'])
  return Object.keys(schema).some((key) => !common.has(key))
}

function replaceAtPath(
  schema: MongoJsonSchema,
  path: SchemaPathSegment[],
  update: (node: MongoJsonSchema) => MongoJsonSchema,
  index = 0
): MongoJsonSchema {
  if (index === path.length) return update(schema)
  const segment = path[index]
  if (segment.kind === 'items') {
    if (!isSchemaObject(schema.items)) return schema
    return {
      ...schema,
      items: replaceAtPath(schema.items, path, update, index + 1)
    }
  }
  const properties = propertiesOf(schema)
  const child = properties[segment.name]
  if (!child) return schema
  return {
    ...schema,
    properties: {
      ...(isSchemaObject(schema.properties) ? schema.properties : {}),
      [segment.name]: replaceAtPath(child, path, update, index + 1)
    }
  }
}

export function setSchemaTypes(root: MongoJsonSchema, path: SchemaPathSegment[], types: string[]): MongoJsonSchema {
  const normalized = [...new Set(types.map((type) => type.trim()).filter(Boolean))]
  if (normalized.length === 0) throw new Error('Choose at least one BSON type.')
  const allowed = new Set<string>(BSON_TYPES)
  const invalid = normalized.filter((type) => !allowed.has(type))
  if (invalid.length > 0) throw new Error(`Unknown BSON type: ${invalid.join(', ')}`)
  return replaceAtPath(root, path, (schema) => {
    const next: MongoJsonSchema = {
      ...schema,
      bsonType: normalized.length === 1 ? normalized[0] : normalized
    }
    if (normalized.includes('object') && !isSchemaObject(next.properties)) next.properties = {}
    if (normalized.includes('array') && !isSchemaObject(next.items)) {
      next.items = { bsonType: 'string' }
    }
    return next
  })
}

export function setSchemaDescription(
  root: MongoJsonSchema,
  path: SchemaPathSegment[],
  description: string
): MongoJsonSchema {
  return replaceAtPath(root, path, (schema) => {
    const next = { ...schema }
    if (description.trim()) next.description = description.trim()
    else delete next.description
    return next
  })
}

export function setPropertyRequired(
  root: MongoJsonSchema,
  parentPath: SchemaPathSegment[],
  name: string,
  required: boolean
): MongoJsonSchema {
  return replaceAtPath(root, parentPath, (parent) => {
    const names = requiredOf(parent).filter((item) => item !== name)
    if (required) names.push(name)
    const next = { ...parent }
    if (names.length > 0) next.required = names
    else delete next.required
    return next
  })
}

export function renameProperty(
  root: MongoJsonSchema,
  parentPath: SchemaPathSegment[],
  from: string,
  to: string
): MongoJsonSchema {
  const name = to.trim()
  if (!name || name === from) return root
  return replaceAtPath(root, parentPath, (parent) => {
    const raw = isSchemaObject(parent.properties) ? parent.properties : {}
    if (Object.prototype.hasOwnProperty.call(raw, name)) throw new Error(`Field "${name}" already exists.`)
    const renamed: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(raw)) renamed[key === from ? name : key] = value
    const required = requiredOf(parent).map((item) => (item === from ? name : item))
    return {
      ...parent,
      properties: renamed,
      ...(required.length > 0 ? { required } : {})
    }
  })
}

export function addProperty(root: MongoJsonSchema, parentPath: SchemaPathSegment[]): MongoJsonSchema {
  return replaceAtPath(root, parentPath, (parent) => {
    const properties = isSchemaObject(parent.properties) ? parent.properties : {}
    let name = 'field'
    let suffix = 2
    while (properties[name]) name = `field${suffix++}`
    return {
      ...parent,
      bsonType: bsonTypesOf(parent).length > 0 ? parent.bsonType : 'object',
      properties: {
        ...(isSchemaObject(parent.properties) ? parent.properties : {}),
        [name]: { bsonType: 'string' }
      }
    }
  })
}

/** Add a nested field to an object, or to an array's object-shaped items. */
export function addChildProperty(root: MongoJsonSchema, path: SchemaPathSegment[]): MongoJsonSchema {
  return replaceAtPath(root, path, (node) => {
    const types = bsonTypesOf(node)
    if (types.includes('object')) return addProperty(node, [])
    if (!types.includes('array')) return node
    const items = isSchemaObject(node.items) ? node.items : { bsonType: 'object', properties: {} }
    const objectItems = {
      ...items,
      bsonType: bsonTypesOf(items).includes('object') ? items.bsonType : 'object'
    }
    return { ...node, items: addProperty(objectItems, []) }
  })
}

export function deleteSchemaNode(
  root: MongoJsonSchema,
  parentPath: SchemaPathSegment[],
  node: Pick<FlatSchemaNode, 'kind' | 'name'>
): MongoJsonSchema {
  return replaceAtPath(root, parentPath, (parent) => {
    if (node.kind === 'items') {
      const next = { ...parent }
      delete next.items
      return next
    }
    const properties = { ...(isSchemaObject(parent.properties) ? parent.properties : {}) }
    delete properties[node.name]
    const required = requiredOf(parent).filter((name) => name !== node.name)
    const next: MongoJsonSchema = { ...parent, properties }
    if (required.length > 0) next.required = required
    else delete next.required
    return next
  })
}

export function flattenSchema(schema: MongoJsonSchema): FlatSchemaNode[] {
  const rows: FlatSchemaNode[] = []

  const walkNested = (node: MongoJsonSchema, path: SchemaPathSegment[], depth: number): void => {
    const types = bsonTypesOf(node)
    if (types.includes('object')) walkProperties(node, path, depth)
    if (types.includes('array') && isSchemaObject(node.items)) {
      const itemPath = [...path, { kind: 'items' } as const]
      rows.push({
        id: JSON.stringify(itemPath),
        path: itemPath,
        parentPath: path,
        kind: 'items',
        name: '[items]',
        depth,
        schema: node.items,
        required: false
      })
      walkNested(node.items, itemPath, depth + 1)
    }
  }

  const walkProperties = (parent: MongoJsonSchema, parentPath: SchemaPathSegment[], depth: number): void => {
    const required = new Set(requiredOf(parent))
    for (const [name, child] of Object.entries(propertiesOf(parent))) {
      const path = [...parentPath, { kind: 'property', name } as const]
      rows.push({
        id: JSON.stringify(path),
        path,
        parentPath,
        kind: 'property',
        name,
        depth,
        schema: child,
        required: required.has(name)
      })
      walkNested(child, path, depth + 1)
    }
  }

  walkProperties(schema, [], 0)
  return rows
}
