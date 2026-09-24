import { Activity, Fragment, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ResizableModal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { copyText, plainScalarText, toPlainJson } from '@renderer/lib/resultCopy'
import { docHasId } from '@renderer/lib/docActions'
import { cellValue, type TableColumnPath } from '@renderer/lib/tableShape'
import { useAppStore } from '@renderer/store/useAppStore'
import { JsonView } from './JsonView'
import { PreviewArrayTable } from './PreviewArrayTable'

export interface JsonPreviewSource {
  connectionId: string
  database: string
  collection: string
  id?: unknown
  /** Table field path to select after refreshing the owning document. */
  field?: TableColumnPath
}

interface JsonPreviewModalProps {
  title: string
  value: unknown
  fontSize: number
  documentView?: boolean
  documentId?: unknown
  source?: JsonPreviewSource
  onValueChange?: (value: unknown) => void
  onClose: () => void
}

interface PreviewLevel {
  value: unknown
  label: string
  view: 'json' | 'table'
  trigger?: HTMLElement
}

export function JsonPreviewModal({
  title,
  value,
  fontSize,
  documentView = false,
  documentId,
  source,
  onValueChange,
  onClose
}: JsonPreviewModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const readDocument = useAppStore((state) => state.readDocument)
  const cancelDocumentRead = useAppStore((state) => state.cancelDocumentRead)
  const notify = useAppStore((state) => state.notify)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [levels, setLevels] = useState<PreviewLevel[]>([{ value, label: title, view: 'json' }])
  if (!Object.is(levels[0].value, value)) {
    setLevels([{ value, label: title, view: levels[0].view }])
  }
  const current = levels[levels.length - 1]
  const { view } = current
  const backRef = useRef<HTMLButtonElement>(null)
  const focusAfterNavigation = useRef<HTMLElement | null>(null)
  const breadcrumbRef = useRef<HTMLDivElement>(null)

  const openNested = (nested: unknown, label: string, trigger: HTMLElement): void => {
    focusAfterNavigation.current = backRef.current
    setLevels((previous) => [...previous, { value: nested, label, view: Array.isArray(nested) ? 'table' : 'json', trigger }])
  }

  const goToLevel = (index: number): void => {
    focusAfterNavigation.current = levels[index + 1].trigger ?? null
    setLevels((previous) => previous.slice(0, index + 1))
  }

  useEffect(() => {
    breadcrumbRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const target = focusAfterNavigation.current
    focusAfterNavigation.current = null
    if (!target) return
    const frame = requestAnimationFrame(() => target.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [levels.length])
  const copyTimer = useRef<number | null>(null)
  const refreshTask = useRef<string | null>(null)
  const canRefresh = source?.id !== undefined && onValueChange != null
  const id = documentView && docHasId(value) ? value._id : documentId
  const idText = id === undefined ? undefined : plainScalarText(id)

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      const taskId = refreshTask.current
      refreshTask.current = null
      if (taskId) void cancelDocumentRead(taskId)
    },
    [cancelDocumentRead]
  )

  useEffect(() => {
    setCopied(false)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [current.value])

  const copy = async (): Promise<void> => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    const ok = await copyText(toPlainJson(current.value))
    if (!ok) return
    setCopied(true)
    copyTimer.current = window.setTimeout(() => {
      setCopied(false)
      copyTimer.current = null
    }, 1500)
  }

  const refresh = async (): Promise<void> => {
    if (!canRefresh || !source) return
    const taskId = `document-refresh:${crypto.randomUUID()}`
    refreshTask.current = taskId
    setRefreshing(true)
    const result = await readDocument({
      connectionId: source.connectionId,
      database: source.database,
      collection: source.collection,
      id: source.id,
      taskId
    })
    if (refreshTask.current !== taskId) return
    refreshTask.current = null
    setRefreshing(false)
    if (!result.ok) {
      notify({
        variant: 'warn',
        title: t('result.documentRefreshFailed', { error: result.error ?? t('notify.unknown') }),
        source: 'document',
        dedupeKey: `document:${source.connectionId}:${source.database}:${source.collection}:refresh`
      })
      return
    }
    if (!result.found) {
      notify({ variant: 'warn', title: t('result.documentMissing'), source: 'document' })
      return
    }
    if (source.field !== undefined) {
      const refreshed = cellValue(result.document, source.field)
      if (!refreshed.present) {
        notify({
          variant: 'warn',
          title: t('result.fieldMissing', {
            field: typeof source.field === 'string' ? source.field : source.field.join('.')
          }),
          source: 'document'
        })
        return
      }
      onValueChange(refreshed.value)
      notify({ variant: 'success', title: t('result.fieldRefreshed'), source: 'document' })
      return
    }
    onValueChange(result.document)
    notify({ variant: 'success', title: t('result.documentRefreshed'), source: 'document' })
  }

  const close = (): void => {
    const taskId = refreshTask.current
    refreshTask.current = null
    if (taskId) void cancelDocumentRead(taskId)
    onClose()
  }

  return (
    <ResizableModal
      title={title}
      titleMeta={
        source || idText !== undefined ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 leading-4">
            {source && (
              <span className="min-w-0 truncate" title={`${source.database}.${source.collection}`}>
                {source.database}.{source.collection}
              </span>
            )}
            {idText !== undefined && (
              <button
                className="group inline-flex min-w-0 max-w-full cursor-pointer items-baseline gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-[12px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
                aria-label={`${t('result.dataMenu.copy')} _id`}
                title={`${t('result.dataMenu.copy')} _id: ${idText}`}
                onClick={async () => {
                  if (await copyText(idText)) {
                    notify({ variant: 'success', title: t('notify.copied'), source: 'document' })
                  }
                }}
              >
                <span className="truncate font-mono text-foreground">{idText}</span>
                <Copy className="size-3 shrink-0 self-center opacity-50 group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            )}
          </span>
        ) : undefined
      }
      compactHeader
      bodyClassName="p-3"
      className={documentView ? 'h-[560px] min-h-[420px]' : undefined}
      backdropClassName="fixed inset-0 z-[1000] bg-[var(--backdrop-dialog)]"
      headerActions={
        <>
          {Array.isArray(current.value) && (
            <div className="view-switch sliding-selection" role="group" aria-label={t('result.dataMenu.view')}>
              {(['json', 'table'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={view === mode ? 'active is-selected' : ''}
                  aria-pressed={view === mode}
                  onClick={() => setLevels((previous) => previous.map((level, index) => index === previous.length - 1 ? { ...level, view: mode } : level))}
                >
                  {mode === 'json' ? 'JSON' : t('result.view.table')}
                </button>
              ))}
              <span className="selection-indicator" aria-hidden="true" />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={copied ? t('notify.copied') : t('result.dataMenu.copy')}
            onClick={() => void copy()}
          >
            {copied ? <Check className="text-[var(--ok)]" /> : <Copy />}
            {t('result.dataMenu.copy')}
          </Button>
          {canRefresh && (
            <Button variant="ghost" size="sm" busy={refreshing} onClick={() => void refresh()}>
              <RefreshCw />
              {t('common.refresh')}
            </Button>
          )}
        </>
      }
      onClose={close}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {(Array.isArray(value) || levels.length > 1) && (
          <nav className="mb-2 flex h-8 shrink-0 items-center gap-1" aria-label={t('result.previewPath')}>
            <button type="button" ref={backRef} className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent text-foreground hover:bg-[var(--interaction-hover)] focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] disabled:opacity-40 disabled:hover:bg-transparent" disabled={levels.length === 1} aria-label={t('result.previewBack')} onClick={() => goToLevel(levels.length - 2)}>
              <ArrowLeft size={16} className="size-4 shrink-0" />
            </button>
            <div ref={breadcrumbRef} className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs">
              {levels.map((level, index) => (
                <span key={index} className="flex shrink-0 items-center gap-1">
                  {index > 0 && <ChevronRight size={14} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <button
                    type="button"
                    className="max-w-48 truncate rounded-sm border-0 bg-transparent px-1 py-1 text-foreground hover:bg-[var(--interaction-hover)] disabled:cursor-default disabled:hover:bg-transparent"
                    title={index === 0 ? title : level.label}
                    aria-current={index === levels.length - 1 ? 'location' : undefined}
                    disabled={index === levels.length - 1}
                    onClick={() => goToLevel(index)}
                  >{index === 0 ? title : level.label}</button>
                </span>
              ))}
            </div>
          </nav>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          {levels.map((level, index) => (
            <Fragment key={index}>
              <Activity mode={index === levels.length - 1 && !(level.view === 'table' && Array.isArray(level.value)) ? 'visible' : 'hidden'}>
                <JsonView value={level.value} fontSize={fontSize} controlsContainer={null} />
              </Activity>
              {Array.isArray(level.value) && (
                <Activity mode={index === levels.length - 1 && level.view === 'table' ? 'visible' : 'hidden'}>
                  <PreviewArrayTable value={level.value} fontSize={fontSize} onOpen={openNested} />
                </Activity>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </ResizableModal>
  )
}
