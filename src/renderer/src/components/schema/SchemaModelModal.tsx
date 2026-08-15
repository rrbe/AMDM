import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MongoJsonSchema, SchemaFieldStat, SchemaModel, SchemaTarget, SchemaTypeStat } from '@shared/types'
import { Button } from '@renderer/components/common/Button'
import { ResizableModal } from '@renderer/components/common/Modal'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'
import { Tabs } from '@renderer/components/ui/Tabs'
import {
  addChildProperty,
  addProperty,
  bsonTypesOf,
  deleteSchemaNode,
  flattenSchema,
  hasAdvancedRules,
  isSchemaObject,
  renameProperty,
  setPropertyRequired,
  setSchemaDescription,
  setSchemaTypes,
  type FlatSchemaNode
} from '@renderer/lib/schemaEdit'
import { useAppStore } from '@renderer/store/useAppStore'

interface Props {
  target: SchemaTarget
  onClose: () => void
}

interface FlatStat {
  id: string
  name: string
  depth: number
  types: string
  count: number
  probability: number
}

function nestedFields(types: SchemaTypeStat[]): SchemaFieldStat[] {
  const fields: SchemaFieldStat[] = []
  for (const type of types) {
    if (type.fields) fields.push(...type.fields)
    if (type.types) fields.push(...nestedFields(type.types))
  }
  return fields
}

function flattenStats(fields: SchemaFieldStat[], parent = '', depth = 0): FlatStat[] {
  const rows: FlatStat[] = []
  fields.forEach((field, index) => {
    const id = `${parent}/${index}:${field.name}`
    rows.push({
      id,
      name: field.name,
      depth,
      types: [...new Set(field.types.map((type) => type.bsonType))].join(' | '),
      count: field.count,
      probability: field.probability
    })
    rows.push(...flattenStats(nestedFields(field.types), id, depth + 1))
  })
  return rows
}

function AnalysisView({ model }: { model: SchemaModel }): React.JSX.Element {
  const { t } = useTranslation()
  const rows = useMemo(() => flattenStats(model.analysis.fields), [model.analysis.fields])
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
        <span>{t('schema.sampleCount', { count: model.analysis.sampleSize })}</span>
        <span>{t('schema.fieldCount', { count: rows.length })}</span>
        <span>{t('schema.analyzedAt', { time: new Date(model.analysis.analyzedAt).toLocaleString() })}</span>
      </div>
      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_90px_90px] border-b border-[var(--separator)] px-3 pb-2 text-[11px] font-medium text-muted-foreground">
        <span>{t('schema.field')}</span>
        <span>{t('schema.bsonType')}</span>
        <span>{t('schema.occurrence')}</span>
        <span>{t('schema.documents')}</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
            {t('schema.emptyCollection')}
          </div>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <div
                  key={row.id}
                  className="absolute left-0 top-0 grid w-full grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_90px_90px] items-center border-b border-[var(--separator)]/60 px-3 text-[12px]"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <span className="truncate font-mono" style={{ paddingLeft: row.depth * 16 }} title={row.name}>
                    {row.name}
                  </span>
                  <span className="truncate font-mono text-muted-foreground" title={row.types}>
                    {row.types}
                  </span>
                  <span>{Math.round(row.probability * 100)}%</span>
                  <span>{row.count}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SchemaRow({
  row,
  onChange,
  onError
}: {
  row: FlatSchemaNode
  onChange: (change: (schema: MongoJsonSchema) => MongoJsonSchema) => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const types = bsonTypesOf(row.schema)
  const canAddChild = types.includes('object') || types.includes('array')

  const safeChange = (change: (schema: MongoJsonSchema) => MongoJsonSchema): boolean => {
    try {
      onChange(change)
      onError(null)
      return true
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  return (
    <div className="grid h-11 grid-cols-[minmax(150px,1fr)_minmax(150px,0.8fr)_78px_minmax(150px,1fr)_68px] items-center gap-2 border-b border-[var(--separator)]/60 px-2">
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: row.depth * 14 }}>
        {row.kind === 'property' ? (
          <Input
            key={row.id}
            className="h-7 min-w-0 px-2 font-mono text-[12px]"
            defaultValue={row.name}
            aria-label={t('schema.field')}
            onBlur={(event) => {
              if (
                !safeChange((schema) =>
                  renameProperty(schema, row.parentPath, row.name, event.currentTarget.value)
                )
              ) {
                event.currentTarget.value = row.name
              }
            }}
          />
        ) : (
          <span className="px-2 font-mono text-[12px] text-muted-foreground">{row.name}</span>
        )}
        {hasAdvancedRules(row.schema) && (
          <span title={t('schema.advancedHint')} className="shrink-0 text-[var(--warn)]">
            <AlertTriangle size={13} />
          </span>
        )}
      </div>
      <Input
        key={`${row.id}:type`}
        className="h-7 px-2 font-mono text-[12px]"
        defaultValue={types.join(', ')}
        placeholder={t('schema.typePlaceholder')}
        aria-label={t('schema.bsonType')}
        onBlur={(event) =>
          safeChange((schema) => setSchemaTypes(schema, row.path, event.currentTarget.value.split(',')))
        }
      />
      {row.kind === 'property' ? (
        <Checkbox
          checked={row.required}
          label={t('schema.requiredShort')}
          onCheckedChange={(checked) =>
            safeChange((schema) => setPropertyRequired(schema, row.parentPath, row.name, checked))
          }
        />
      ) : (
        <span />
      )}
      <Input
        key={`${row.id}:description`}
        className="h-7 px-2 text-[12px]"
        defaultValue={typeof row.schema.description === 'string' ? row.schema.description : ''}
        placeholder={t('schema.description')}
        aria-label={t('schema.description')}
        onBlur={(event) => safeChange((schema) => setSchemaDescription(schema, row.path, event.currentTarget.value))}
      />
      <div className="flex justify-end gap-0.5">
        {canAddChild && (
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-[var(--interaction-hover)] hover:text-foreground focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
            title={t('schema.addNestedField')}
            aria-label={t('schema.addNestedField')}
            onClick={() => safeChange((schema) => addChildProperty(schema, row.path))}
          >
            <Plus size={14} />
          </button>
        )}
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
          title={t('schema.deleteField')}
          aria-label={t('schema.deleteField')}
          onClick={() => safeChange((schema) => deleteSchemaNode(schema, row.parentPath, row))}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function StructuredEditor({
  schema,
  onChange,
  onError
}: {
  schema: MongoJsonSchema
  onChange: (schema: MongoJsonSchema) => void
  onError: (message: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rows = useMemo(() => flattenSchema(schema), [schema])
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[minmax(150px,1fr)_minmax(150px,0.8fr)_78px_minmax(150px,1fr)_68px] items-center gap-2 border-b border-[var(--separator)] px-2 pb-2 text-[11px] font-medium text-muted-foreground">
        <span>{t('schema.field')}</span>
        <span>{t('schema.bsonType')}</span>
        <span>{t('schema.required')}</span>
        <span>{t('schema.description')}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(addProperty(schema, []))}>
          <Plus /> {t('schema.addField')}
        </Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={`${row.id}:${JSON.stringify(row.schema)}:${row.required}`}
                className="absolute left-0 top-0 w-full"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <SchemaRow row={row} onError={onError} onChange={(change) => onChange(change(schema))} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function parseDraft(text: string): MongoJsonSchema {
  const parsed = JSON.parse(text) as unknown
  if (!isSchemaObject(parsed)) throw new Error('Schema must be a JSON object.')
  return parsed
}

export function SchemaModelModal({ target, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const loadSchemaModel = useAppStore((state) => state.loadSchemaModel)
  const analyzeSchema = useAppStore((state) => state.analyzeSchema)
  const saveSchemaDraft = useAppStore((state) => state.saveSchemaDraft)
  const overwriteSchemaDraft = useAppStore((state) => state.overwriteSchemaDraft)
  const [model, setModel] = useState<SchemaModel | null>(null)
  const [draft, setDraft] = useState<MongoJsonSchema | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [section, setSection] = useState<'analysis' | 'model'>('analysis')
  const [editMode, setEditMode] = useState<'structured' | 'json'>('structured')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyDraft = (next: MongoJsonSchema): void => {
    setDraft(next)
    setJsonText(JSON.stringify(next, null, 2))
    setDirty(true)
  }

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      let loaded = await loadSchemaModel(target)
      if (!loaded) loaded = await analyzeSchema(target)
      if (!active) return
      if (loaded) {
        setModel(loaded)
        setDraft(loaded.draft)
        setJsonText(JSON.stringify(loaded.draft, null, 2))
      }
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [analyzeSchema, loadSchemaModel, target])

  const updateAnalysis = async (): Promise<void> => {
    setAnalyzing(true)
    setError(null)
    const next = await analyzeSchema(target)
    if (next) {
      setModel(next)
      if (!dirty) {
        setDraft(next.draft)
        setJsonText(JSON.stringify(next.draft, null, 2))
      }
    }
    setAnalyzing(false)
  }

  const switchEditMode = (mode: 'structured' | 'json'): void => {
    if (mode === 'structured' && editMode === 'json') {
      try {
        const parsed = parseDraft(jsonText)
        setDraft(parsed)
        setError(null)
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : String(parseError))
        return
      }
    }
    setEditMode(mode)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    setError(null)
    let next = draft
    if (editMode === 'json') {
      try {
        next = parseDraft(jsonText)
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : String(parseError))
        return
      }
    }
    setSaving(true)
    const saved = await saveSchemaDraft(target, next)
    if (saved) {
      setModel(saved)
      setDraft(saved.draft)
      setJsonText(JSON.stringify(saved.draft, null, 2))
      setDirty(false)
    }
    setSaving(false)
  }

  const overwrite = async (): Promise<void> => {
    if (!window.confirm(t('schema.overwriteConfirm'))) return
    const next = await overwriteSchemaDraft(target)
    if (!next) return
    setModel(next)
    setDraft(next.draft)
    setJsonText(JSON.stringify(next.draft, null, 2))
    setDirty(false)
    setError(null)
  }

  const close = (): void => {
    if (dirty && !window.confirm(t('schema.discardConfirm'))) return
    onClose()
  }

  return (
    <ResizableModal
      title={t('schema.title', { collection: target.collection })}
      className="h-[min(720px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))] max-w-none"
      bodyClassName="flex flex-col gap-3"
      onClose={close}
      headerActions={
        <Button size="sm" busy={analyzing} disabled={loading} onClick={() => void updateAnalysis()}>
          <RefreshCw /> {t('schema.updateAnalysis')}
        </Button>
      }
      footer={
        <>
          {error && (
            <span className="max-w-[60%] truncate text-[12px] text-destructive" title={error}>
              {error}
            </span>
          )}
          <span className="spacer" />
          <Button onClick={close}>{t('schema.close')}</Button>
          {section === 'model' && (
            <Button variant="primary" busy={saving} disabled={!dirty} onClick={() => void save()}>
              <Save /> {t('schema.saveDraft')}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="grid h-full place-items-center text-[13px] text-muted-foreground">{t('schema.loading')}</div>
      ) : model && draft ? (
        <>
          <Tabs
            value={section}
            onChange={setSection}
            items={[
              { value: 'analysis', label: t('schema.analysisTab') },
              { value: 'model', label: t('schema.modelTab') }
            ]}
            className="border-b border-[var(--separator)]"
          />
          {section === 'analysis' ? (
            <AnalysisView model={model} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-3">
                <Tabs
                  value={editMode}
                  onChange={switchEditMode}
                  items={[
                    { value: 'structured', label: t('schema.structuredTab') },
                    { value: 'json', label: 'JSON' }
                  ]}
                />
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => void overwrite()}>
                  <RotateCcw /> {t('schema.overwriteDraft')}
                </Button>
              </div>
              {editMode === 'structured' ? (
                <StructuredEditor schema={draft} onChange={applyDraft} onError={setError} />
              ) : (
                <textarea
                  className="min-h-0 flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--separator)] bg-[var(--surface-control)] p-3 font-mono text-[12px] leading-5 text-foreground outline-none focus:border-[var(--separator-strong)] focus:[outline:3px_solid_var(--focus-soft)]"
                  spellCheck={false}
                  value={jsonText}
                  onChange={(event) => {
                    setJsonText(event.target.value)
                    setDirty(true)
                    setError(null)
                  }}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="grid h-full place-items-center text-[13px] text-muted-foreground">{t('schema.loadFailed')}</div>
      )}
    </ResizableModal>
  )
}
