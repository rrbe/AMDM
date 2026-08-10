import { describe, expect, it } from 'vitest'
import type { MongoJsonSchema } from '../../../src/shared/types'
import {
  addChildProperty,
  deleteSchemaNode,
  flattenSchema,
  renameProperty,
  setPropertyRequired,
  setSchemaTypes
} from '../../../src/renderer/src/lib/schemaEdit'

const base = (): MongoJsonSchema => ({
  bsonType: 'object',
  required: ['user'],
  properties: {
    user: {
      bsonType: 'object',
      properties: { name: { bsonType: 'string', enum: ['a', 'b'] } }
    },
    tags: {
      bsonType: 'array',
      items: { bsonType: 'object', properties: { value: { bsonType: 'int' } } }
    }
  }
})

describe('Schema structured editing', () => {
  it('flattens nested objects and array items', () => {
    expect(flattenSchema(base()).map((row) => row.name)).toEqual(['user', 'name', 'tags', '[items]', 'value'])
  })

  it('renames and removes fields while keeping required in sync', () => {
    let schema = renameProperty(base(), [], 'user', 'account')
    expect(schema.required).toEqual(['account'])
    const account = flattenSchema(schema).find((row) => row.name === 'account')!
    schema = setPropertyRequired(schema, account.parentPath, account.name, false)
    expect(schema.required).toBeUndefined()
    schema = deleteSchemaNode(schema, account.parentPath, account)
    expect(flattenSchema(schema).some((row) => row.name === 'account')).toBe(false)
  })

  it('changes common fields without dropping advanced JSON rules', () => {
    const name = flattenSchema(base()).find((row) => row.name === 'name')!
    const schema = setSchemaTypes(base(), name.path, ['string', 'null'])
    const changed = flattenSchema(schema).find((row) => row.name === 'name')!.schema
    expect(changed.bsonType).toEqual(['string', 'null'])
    expect(changed.enum).toEqual(['a', 'b'])
    expect(() => setSchemaTypes(base(), name.path, ['not-a-bson-type'])).toThrow('Unknown BSON type')
  })

  it('adds a field inside array object items', () => {
    const tags = flattenSchema(base()).find((row) => row.name === 'tags')!
    const schema = addChildProperty(base(), tags.path)
    expect(flattenSchema(schema).map((row) => row.name)).toContain('field')
  })
})
