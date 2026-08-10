import { describe, expect, it } from 'vitest'
import { cloneMongoJsonSchema, schemaTargetKey } from '../../../src/main/store/schemaStoreCore'

describe('schemaStoreCore', () => {
  it('builds an unambiguous namespace key', () => {
    expect(schemaTargetKey({ connectionId: 'c', database: 'a.b', collection: 'd' })).not.toBe(
      schemaTargetKey({ connectionId: 'c', database: 'a', collection: 'b.d' })
    )
  })

  it('clones JSON schemas and rejects values JSON cannot persist safely', () => {
    const source = { bsonType: 'object', properties: { n: { bsonType: 'int' } } }
    const cloned = cloneMongoJsonSchema(source)
    expect(cloned).toEqual(source)
    expect(cloned).not.toBe(source)
    expect(() => cloneMongoJsonSchema({ maximum: Number.POSITIVE_INFINITY })).toThrow('finite')
    expect(() => cloneMongoJsonSchema([])).toThrow('JSON object')
  })
})
