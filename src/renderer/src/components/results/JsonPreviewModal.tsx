import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ResizableModal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { copyText, toPlainJson } from '@renderer/lib/resultCopy'
import { cellValue } from '@renderer/lib/tableShape'
import { useAppStore } from '@renderer/store/useAppStore'
import { JsonView } from './JsonView'

export interface JsonPreviewSource {
  connectionId: string
  database: string
  collection: string
  id?: unknown
  /** Table field path to select after refreshing the owning document. */
  field?: string
}

interface JsonPreviewModalProps {
  title: string
  value: unknown
  fontSize: number
  documentView?: boolean
  source?: JsonPreviewSource
  onValueChange?: (value: unknown) => void
  onClose: () => void
}

export function JsonPreviewModal({
  title,
  value,
  fontSize,
  documentView = false,
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
  const copyTimer = useRef<number | null>(null)
  const refreshTask = useRef<string | null>(null)
  const canRefresh = source?.id !== undefined && onValueChange != null

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      const taskId = refreshTask.current
      refreshTask.current = null
      if (taskId) void cancelDocumentRead(taskId)
    },
    [cancelDocumentRead]
  )

  const copy = async (): Promise<void> => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    const ok = await copyText(toPlainJson(value))
    if (!ok) {
      notify('warn', t('notify.clipboardUnavailable'))
      return
    }
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
      notify('warn', t('result.documentRefreshFailed', { error: result.error ?? t('notify.unknown') }))
      return
    }
    if (!result.found) {
      notify('warn', t('result.documentMissing'))
      return
    }
    if (source.field !== undefined) {
      const refreshed = cellValue(result.document, source.field)
      if (!refreshed.present) {
        notify('warn', t('result.fieldMissing', { field: source.field }))
        return
      }
      onValueChange(refreshed.value)
      notify('success', t('result.fieldRefreshed'))
      return
    }
    onValueChange(result.document)
    notify('success', t('result.documentRefreshed'))
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
      titleMeta={source ? `${source.database}.${source.collection}` : undefined}
      compactHeader
      className={documentView ? 'h-[560px] min-h-[420px]' : undefined}
      backdropClassName="fixed inset-0 z-[1000] bg-[var(--backdrop-dialog)]"
      headerActions={
        <>
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
      <div className="h-full min-h-0 overflow-hidden rounded-md border border-[var(--separator)] p-3">
        <JsonView value={value} fontSize={fontSize} />
      </div>
    </ResizableModal>
  )
}
