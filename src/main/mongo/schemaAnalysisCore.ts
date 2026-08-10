import type { Db } from 'mongodb'
import type { SchemaAnalysis } from '../../shared/types'
import { serializerPool } from '../workers/serializerPool'

export const SCHEMA_SAMPLE_SIZE = 50

/** Driver-facing core: bounded random sample, then off-thread inference. */
export async function analyzeCollectionSchemaOnDb(
  db: Db,
  collection: string,
  timeoutMS: number,
  sampleSize = SCHEMA_SAMPLE_SIZE
): Promise<SchemaAnalysis> {
  const size = Math.min(SCHEMA_SAMPLE_SIZE, Math.max(1, Math.floor(sampleSize) || 1))
  const options = timeoutMS > 0 ? { maxTimeMS: timeoutMS } : undefined
  const docs = await db
    .collection(collection)
    .aggregate([{ $sample: { size } }], options)
    .toArray()
  const analysis = await serializerPool.analyzeSchema(docs)
  return { ...analysis, analyzedAt: Date.now() }
}
