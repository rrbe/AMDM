import { describe, expect, it } from 'vitest'
import { analyzeSchemaDocuments } from '../../../src/main/workers/schema-analysis-core'

describe('analyzeSchemaDocuments', () => {
  it('infers a recursive MongoDB JSON Schema without retaining sampled values', async () => {
    const result = await analyzeSchemaDocuments([
      { profile: { name: 'a' }, mixed: 1 },
      { profile: { name: 'b' }, mixed: 'two' }
    ])
    expect(result.sampleSize).toBe(2)
    expect(result.generated).toMatchObject({
      bsonType: 'object',
      properties: {
        profile: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
        mixed: { bsonType: ['double', 'string'] }
      }
    })
    expect(JSON.stringify(result.fields)).not.toContain('two')
  })

  it('returns a useful empty object model when there are no documents', async () => {
    expect(await analyzeSchemaDocuments([])).toEqual({
      sampleSize: 0,
      fields: [],
      generated: { bsonType: 'object', properties: {} }
    })
  })
})
