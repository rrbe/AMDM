import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  CircleQuestionMark,
  Clock,
  Database,
  KeyRound,
  Maximize2,
  Network,
  Plug,
  RefreshCw,
  Search,
  Table2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SchemaTarget } from '@shared/types'
import { getActiveResult, getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { tabCollection } from '@renderer/lib/tabs'
import {
  schemaPanelTarget,
  buildSchemaTree,
  schemaPanelKey,
  visibleSchemaRows,
  schemaNodeLabel,
  type SchemaTreeRow
} from '@renderer/lib/schemaPanel'
import { formatMongoHosts } from '@renderer/lib/connectionUri'
import { Button } from '@renderer/components/common/Button'
import { Input } from '@renderer/components/ui/Input'
import { Popover } from '@renderer/components/ui/Popover'
import { Tooltip } from '@renderer/components/ui/Tooltip'

const SchemaModelModal = lazy(async () => ({
  default: (await import('@renderer/components/schema/SchemaModelModal')).SchemaModelModal
}))

export function ContextPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const connectionId = useAppStore((s) => getActiveTab(s).connectionId)
  const database = useAppStore((s) => getActiveTab(s).activeDatabase)
  const collection = useAppStore((s) => schemaPanelTarget(getActiveTab(s))?.collection)
  const connected = useAppStore((s) => (connectionId ? s.statuses[connectionId]?.state === 'connected' : false))
  const isView = useAppStore((s) =>
    connectionId
      ? (s.catalogs[connectionId]?.collections[database]?.some(
          (item) => item.name === collection && item.type === 'view'
        ) ?? false)
      : false
  )
  const [view, setView] = useState<'schema' | 'info'>('schema')
  const target = useMemo<SchemaTarget | null>(
    () => (connectionId && database && collection ? { connectionId, database, collection } : null),
    [connectionId, database, collection]
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-sidebar)]" data-schema-panel>
      <nav className="explorer-nav" aria-label={t('context.title')}>
        <Tooltip content={t('context.schema.label')}>
          <button
            className={view === 'schema' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
            aria-label={t('context.schema.label')}
            aria-current={view === 'schema' ? 'page' : undefined}
            onClick={() => setView('schema')}
          >
            <Network size={16} />
            <span className="explorer-nav-label" aria-hidden="true">
              <span>{t('context.schema.label')}</span>
            </span>
          </button>
        </Tooltip>
        <Tooltip content={t('context.schema.collectionInfo')}>
          <button
            className={view === 'info' ? 'explorer-nav-item is-active' : 'explorer-nav-item'}
            aria-label={t('context.schema.collectionInfo')}
            aria-current={view === 'info' ? 'page' : undefined}
            onClick={() => setView('info')}
          >
            <BookOpenText size={16} />
            <span className="explorer-nav-label" aria-hidden="true">
              <span>{t('context.schema.collectionInfo')}</span>
            </span>
          </button>
        </Tooltip>
      </nav>
      {view === 'info' ? (
        <CollectionInfo />
      ) : target ? (
        <CollectionSchema key={schemaPanelKey(target)} target={target} connected={connected} isView={isView} />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-5 text-center text-[12px] text-muted-foreground">
          {t('context.schema.selectCollection')}
        </div>
      )}
    </div>
  )
}

function CollectionInfo(): React.JSX.Element {
  const { t } = useTranslation()
  const tab = useAppStore(getActiveTab)
  const activeResult = useAppStore(getActiveResult)
  const connections = useAppStore((s) => s.connections)
  const catalogs = useAppStore((s) => s.catalogs)

  const connection = connections.find((item) => item.id === tab.connectionId)
  const database = tab.activeDatabase || activeResult?.query?.database || ''
  const result = activeResult?.result
  const collection = tabCollection(tab) ?? result?.collection ?? ''
  const catalog = tab.connectionId ? catalogs[tab.connectionId] : undefined
  const collectionInfo = catalog?.collections[database]?.find((item) => item.name === collection)
  const indexes = catalog?.indexes[`${database}/${collection}`]
  const deployment = connection
    ? connection.useSrv
      ? connection.host
      : formatMongoHosts(connection.host, connection.port ?? 27017)
    : '—'
  const resultSummary = !result
    ? t('context.noResult')
    : result.kind === 'documents'
      ? t('result.docCount', { count: result.count ?? 0 })
      : result.kind === 'value'
        ? t('result.kindValue')
        : result.kind === 'ack'
          ? t('result.kindAck')
          : result.kind === 'explain'
            ? t('result.explainTag')
            : result.errorName || t('result.errorName')

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-sidebar)]">
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <section className="py-2">
          <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">{t('context.target')}</h2>
          <dl className="m-0 grid gap-1">
            <PropertyRow icon={<Plug />} label={t('context.connection')} value={connection?.name || '—'} />
            <PropertyRow icon={<Database />} label={t('context.deployment')} value={deployment} mono />
            <PropertyRow icon={<Database />} label={t('context.database')} value={database || '—'} mono />
            <PropertyRow icon={<Table2 />} label={t('context.collection')} value={collection || '—'} mono />
          </dl>
        </section>

        {collection && (
          <section className="mt-4 py-2">
            <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">{t('context.collection')}</h2>
            <dl className="m-0 grid gap-1">
              <PropertyRow
                icon={<Table2 />}
                label={t('context.type')}
                value={collectionInfo ? t(`context.collectionType.${collectionInfo.type}`) : t('context.notLoaded')}
              />
              <PropertyRow
                icon={<Table2 />}
                label={t('context.documents')}
                value={
                  collectionInfo?.estimatedCount === undefined ? '—' : collectionInfo.estimatedCount.toLocaleString()
                }
                mono
              />
              <PropertyRow
                icon={<KeyRound />}
                label={t('context.indexes')}
                value={indexes ? indexes.length.toLocaleString() : t('context.notLoaded')}
                mono={!!indexes}
              />
            </dl>
          </section>
        )}

        <section className="mt-4 py-2">
          <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">{t('context.lastResult')}</h2>
          <dl className="m-0 grid gap-1">
            <PropertyRow icon={<Table2 />} label={t('context.result')} value={resultSummary} />
            <PropertyRow
              icon={<Clock />}
              label={t('context.elapsed')}
              value={typeof result?.elapsedMs === 'number' ? t('result.elapsed', { ms: result.elapsedMs }) : '—'}
              mono
            />
          </dl>
        </section>
      </div>
    </div>
  )
}

function CollectionSchema({
  target,
  connected,
  isView
}: {
  target: SchemaTarget
  connected: boolean
  isView: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const key = schemaPanelKey(target)
  const panel = useAppStore((s) => s.schemaPanels[key])
  const loadSchemaModel = useAppStore((s) => s.loadSchemaModel)
  const analyzeSchema = useAppStore((s) => s.analyzeSchema)
  const updateSchemaPanel = useAppStore((s) => s.updateSchemaPanel)
  const [loading, setLoading] = useState(() => panel?.model === undefined)
  const [showModel, setShowModel] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasConnected = useRef(connected)
  const model = panel?.model

  useEffect(() => {
    const disconnected = wasConnected.current && !connected
    wasConnected.current = connected
    if (disconnected) {
      setLoading(false)
      setShowModel(false)
      return
    }
    let active = true
    setLoading(useAppStore.getState().schemaPanels[key]?.model === undefined)
    void loadSchemaModel(target).then(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadSchemaModel, target, connected])

  const tree = useMemo(() => buildSchemaTree(model?.analysis.fields ?? []), [model?.analysis.fields])
  const rows = useMemo(
    () => visibleSchemaRows(tree, panel?.expanded ?? new Set(), panel?.search ?? ''),
    [tree, panel?.expanded, panel?.search]
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 6,
    getItemKey: (index) => rows[index].id,
    initialOffset: () => useAppStore.getState().schemaPanels[key]?.scrollTop ?? 0
  })

  const toggle = (row: SchemaTreeRow): void => {
    const expanded = new Set(panel?.expanded)
    if (expanded.has(row.id)) expanded.delete(row.id)
    else expanded.add(row.id)
    updateSchemaPanel(target, { expanded })
  }
  const analyze = (): void => {
    void analyzeSchema(target)
  }
  const canAnalyze = connected && !isView

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <span
          className="mr-auto min-w-0 truncate font-mono text-[12px]"
          title={`${target.database} / ${target.collection}`}
        >
          <span className="text-muted-foreground">{target.database} / </span>
          {target.collection}
        </span>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-[var(--interaction-hover)] hover:text-foreground disabled:opacity-40"
          aria-label={t('context.schema.refresh')}
          title={t('context.schema.refresh')}
          disabled={!canAnalyze || loading || panel?.analyzing || !model}
          onClick={analyze}
        >
          <RefreshCw size={14} className={panel?.analyzing ? 'animate-spin motion-reduce:animate-none' : ''} />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-[var(--interaction-hover)] hover:text-foreground disabled:opacity-40"
          aria-label={t('context.schema.openFull')}
          title={t('context.schema.openFull')}
          disabled={!model || panel?.analyzing}
          onClick={() => setShowModel(true)}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {model && model.analysis.fields.length > 0 && (
        <>
          <div className="relative mx-3 mb-2 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" size={13} />
            <Input
              className="h-8 pl-8 pr-2 text-[12px]"
              placeholder={t('context.schema.search')}
              aria-label={t('context.schema.search')}
              value={panel?.search ?? ''}
              onChange={(event) => {
                updateSchemaPanel(target, {
                  search: event.currentTarget.value,
                  scrollTop: 0
                })
                virtualizer.scrollToOffset(0)
              }}
            />
          </div>
          <div className="grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_92px] items-center gap-2 border-b border-[var(--separator)] pl-[10px] pr-3 text-[11px] text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-4 shrink-0" aria-hidden />
              <span>{t('schema.field')}</span>
              <Popover
                label={t('context.schema.sampleInfo')}
                trigger={
                  <button
                    type="button"
                    aria-label={t('context.schema.sampleInfo')}
                    className="inline-flex size-5 items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground hover:bg-[var(--interaction-hover)] hover:text-foreground"
                  >
                    <CircleQuestionMark size={13} aria-hidden />
                  </button>
                }
              >
                {t('context.schema.sampleHint')}
              </Popover>
            </span>
            <span>{t('context.type')}</span>
          </div>
        </>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        data-schema-scroll
        onScroll={(event) =>
          updateSchemaPanel(target, {
            scrollTop: event.currentTarget.scrollTop
          })
        }
      >
        {loading ? (
          <EmptyState>{t('schema.loading')}</EmptyState>
        ) : model ? (
          model.analysis.fields.length === 0 ? (
            <EmptyState>{t('schema.emptyCollection')}</EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState>{t('context.schema.noMatches')}</EmptyState>
          ) : (
            <div
              role="list"
              aria-label={t('context.schema.fields')}
              className="relative"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                const expandable = row.children.length > 0
                const open = !!panel?.search.trim() || !!panel?.expanded.has(row.id)
                const types = row.types.map((type) => type.name).join(' · ')
                return (
                  <div
                    key={row.id}
                    role="listitem"
                    data-schema-field={row.path}
                    className="absolute left-0 top-0 grid w-full grid-cols-[minmax(0,1fr)_92px] items-center gap-2 border-b border-[var(--separator)]/50 pr-3 font-mono text-[12px] hover:bg-[var(--interaction-hover)]"
                    style={{
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                      paddingLeft: 10 + Math.min(row.depth, 6) * 12
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        className="flex size-4 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground disabled:pointer-events-none"
                        aria-label={t(open ? 'context.schema.collapse' : 'context.schema.expand', { field: row.path })}
                        aria-expanded={expandable ? open : undefined}
                        disabled={!expandable || !!panel?.search.trim()}
                        onClick={() => toggle(row)}
                      >
                        {expandable && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                      </button>
                      <Tooltip content={row.name} variant="code" overflowOnly>
                        <span className="min-w-0 flex-1 truncate">{schemaNodeLabel(row)}</span>
                      </Tooltip>
                    </div>
                    <span className="min-w-0 truncate" title={types}>
                      {row.types.map((type, index) => (
                        <span key={type.bsonType}>
                          {index > 0 && <span className="text-muted-foreground"> · </span>}
                          <span className={`v-${schemaColor(type.bsonType)}`}>{type.name}</span>
                        </span>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <EmptyState>
            <span>{isView ? t('context.schema.viewUnsupported') : t('context.schema.notAnalyzed')}</span>
            {!isView && (
              <Button size="sm" busy={panel?.analyzing} disabled={!canAnalyze} onClick={analyze}>
                {t('context.schema.analyze')}
              </Button>
            )}
          </EmptyState>
        )}
      </div>
      {(panel?.error || (panel?.analyzing && model) || !connected) && (
        <div className="shrink-0 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
          {panel?.error && <div className="mb-1 break-words text-destructive">{panel.error}</div>}
          {panel?.analyzing && model && <div className="mb-1">{t('context.schema.analyzing')}</div>}
          {!connected && <div className="mb-1">{t('context.schema.disconnected')}</div>}
        </div>
      )}
      {showModel && (
        <Suspense fallback={<div className="px-3 text-[12px] text-muted-foreground">{t('schema.loading')}</div>}>
          <SchemaModelModal target={target} onClose={() => setShowModel(false)} />
        </Suspense>
      )}
    </>
  )
}

function schemaColor(bsonType: string): string {
  switch (bsonType) {
    case 'String':
      return 'string'
    case 'Boolean':
      return 'boolean'
    case 'ObjectId':
      return 'objectId'
    case 'Date':
    case 'Timestamp':
      return 'date'
    case 'Number':
    case 'Int32':
    case 'Long':
    case 'Double':
    case 'Decimal128':
      return 'number'
    case 'Binary':
      return 'binary'
    case 'RegExp':
    case 'BSONRegExp':
      return 'regex'
    default:
      return 'null'
  }
}

function EmptyState({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-3 px-5 text-center text-[12px] text-muted-foreground">
      {children}
    </div>
  )
}

function PropertyRow({
  icon,
  label,
  value,
  mono = false
}: {
  icon: ReactNode
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="grid min-h-7 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-x-2">
      <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <dt className="truncate text-[12px] text-muted-foreground">{label}</dt>
      <dd
        className={`m-0 truncate text-[12px] font-medium text-foreground ${mono ? 'font-mono font-normal' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
