import { analyzeDocuments, type InternalSchema, type SchemaType } from '@mongodb-js/mongodb-schema'
import type { MongoJsonSchema, SchemaAnalysis, SchemaFieldStat, SchemaTypeStat } from '../../shared/types'

export const MAX_SCHEMA_FIELDS = 500

function normalizeType(type: SchemaType): SchemaTypeStat {
  const out: SchemaTypeStat = {
    name: type.name,
    bsonType: type.bsonType,
    count: type.count,
    probability: type.probability
  }
  if ('fields' in type) out.fields = type.fields.map(normalizeField)
  if ('types' in type) out.types = type.types.map(normalizeType)
  return out
}

function normalizeField(field: InternalSchema['fields'][number]): SchemaFieldStat {
  return {
    name: field.name,
    count: field.count,
    probability: field.probability,
    types: field.types.map(normalizeType)
  }
}

/** CPU-only inference shared by the worker and its main-thread fallback. */
export async function analyzeSchemaDocuments(docs: unknown[]): Promise<Omit<SchemaAnalysis, 'analyzedAt'>> {
  if (docs.length === 0) {
    return {
      sampleSize: 0,
      fields: [],
      generated: { bsonType: 'object', properties: {} }
    }
  }

  const accessor = await analyzeDocuments(docs, {
    storeValues: false,
    distinctFieldsAbortThreshold: MAX_SCHEMA_FIELDS
  })
  const [internal, generated] = await Promise.all([accessor.getInternalSchema(), accessor.getMongoDBJsonSchema()])
  return {
    sampleSize: internal.count,
    fields: internal.fields.map(normalizeField),
    generated: generated as MongoJsonSchema
  }
}
