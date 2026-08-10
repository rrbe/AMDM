import type { SchemaAnalysis, SchemaTarget } from '../../shared/types'
import { sessionManager } from './sessionManager'
import { analyzeCollectionSchemaOnDb } from './schemaAnalysisCore'

function validateTarget(target: SchemaTarget): void {
  if (!target?.connectionId || !target.database || !target.collection) {
    throw new Error('Invalid schema target.')
  }
}

/** Thin session wrapper around the driver-only analysis core. */
export async function analyzeCollectionSchema(target: SchemaTarget, timeoutMS: number): Promise<SchemaAnalysis> {
  validateTarget(target)
  const db = sessionManager.getClient(target.connectionId).db(target.database)
  return analyzeCollectionSchemaOnDb(db, target.collection, timeoutMS)
}
