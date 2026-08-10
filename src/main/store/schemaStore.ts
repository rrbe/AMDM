import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { MongoJsonSchema, SchemaAnalysis, SchemaModel, SchemaTarget } from '../../shared/types'
import { cloneMongoJsonSchema, schemaTargetKey } from './schemaStoreCore'

interface SchemaFile {
  version: 1
  models: Record<string, SchemaModel>
}

/** Persists observed Schema snapshots and independent user drafts to schemas.json. */
class SchemaStore {
  private filePath = ''
  private data: SchemaFile = { version: 1, models: {} }

  init(): void {
    this.filePath = join(app.getPath('userData'), 'schemas.json')
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SchemaFile>
      this.data = { version: 1, models: parsed.models ?? {} }
    } catch {
      this.data = { version: 1, models: {} }
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }

  get(target: SchemaTarget): SchemaModel | null {
    return this.data.models[schemaTargetKey(target)] ?? null
  }

  saveAnalysis(target: SchemaTarget, analysis: SchemaAnalysis): SchemaModel {
    const key = schemaTargetKey(target)
    const previous = this.data.models[key]
    const model: SchemaModel = {
      target,
      analysis,
      draft: previous?.draft ?? cloneMongoJsonSchema(analysis.generated),
      draftUpdatedAt: previous?.draftUpdatedAt ?? analysis.analyzedAt
    }
    this.data.models[key] = model
    this.persist()
    return model
  }

  saveDraft(target: SchemaTarget, draft: MongoJsonSchema): SchemaModel {
    const key = schemaTargetKey(target)
    const previous = this.data.models[key]
    if (!previous) throw new Error('Analyze the collection before saving a Schema.')
    const model = {
      ...previous,
      draft: cloneMongoJsonSchema(draft),
      draftUpdatedAt: Date.now()
    }
    this.data.models[key] = model
    this.persist()
    return model
  }

  overwriteDraft(target: SchemaTarget): SchemaModel {
    const key = schemaTargetKey(target)
    const previous = this.data.models[key]
    if (!previous) throw new Error('Analyze the collection before overwriting the draft.')
    const model = {
      ...previous,
      draft: cloneMongoJsonSchema(previous.analysis.generated),
      draftUpdatedAt: Date.now()
    }
    this.data.models[key] = model
    this.persist()
    return model
  }

  deleteConnection(connectionId: string): void {
    const models = Object.fromEntries(
      Object.entries(this.data.models).filter(([, model]) => model.target.connectionId !== connectionId)
    )
    if (Object.keys(models).length === Object.keys(this.data.models).length) return
    this.data.models = models
    this.persist()
  }
}

export const schemaStore = new SchemaStore()
