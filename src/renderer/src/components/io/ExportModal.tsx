/**
 * Export-a-collection modal.
 *
 * Lets the user pick a target format (JSON / CSV / XLSX / BSON), optionally
 * constrain with an EJSON query filter + limit, and tune format-specific
 * options. The actual write (and the OS save dialog) happens in the main
 * process via `exportCollection`; this component only collects the request and
 * renders the returned `DataOpResult`.
 *
 *  - BSON is driven by `mongodump` (an archive). It's disabled when the tool is
 *    not installed; the query filter still applies but the CSV/array options
 *    don't.
 *  - `res.cancelled` (user dismissed the save dialog) just closes the modal.
 *  - `res.ok` keeps the modal open showing a success summary + Close button.
 *  - otherwise the error is shown in a red box.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { useAppStore } from '@renderer/store/useAppStore'
import type { DataFormat, DataOpResult } from '@shared/types'

interface ExportModalProps {
  connectionId: string
  database: string
  collection: string
  onClose: () => void
}

const FORMATS: Array<{ value: DataFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'XLSX' },
  { value: 'bson', label: 'BSON' }
]

export function ExportModal({ connectionId, database, collection, onClose }: ExportModalProps): JSX.Element {
  const { t } = useTranslation()
  const toolStatus = useAppStore((s) => s.toolStatus)
  const exportCollection = useAppStore((s) => s.exportCollection)

  const [format, setFormat] = useState<DataFormat>('json')
  const [jsonArray, setJsonArray] = useState(true)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DataOpResult | null>(null)

  const bsonReady = Boolean(toolStatus?.mongodump)
  const isBson = format === 'bson'
  const isJson = format === 'json'

  const onExport = async (): Promise<void> => {
    setResult(null)
    setRunning(true)
    const trimmedQuery = query.trim()
    const parsedLimit = Number.parseInt(limit, 10)
    const res = await exportCollection({
      connectionId,
      database,
      collection,
      format,
      query: trimmedQuery ? trimmedQuery : undefined,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      jsonArray: isJson ? jsonArray : undefined
    })
    setRunning(false)
    if (res.cancelled) {
      onClose()
      return
    }
    setResult(res)
  }

  const success = result?.ok === true

  return (
    <Modal
      title={t('io.exportTitle', { ns: `${database}.${collection}` })}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{success ? t('io.close') : t('io.cancel')}</Button>
          {!success && (
            <Button
              variant="primary"
              busy={running}
              disabled={isBson && !bsonReady}
              onClick={() => void onExport()}
            >
              {t('io.exportBtn')}
            </Button>
          )}
        </>
      }
    >
      <div className="form-row">
        <label>{t('io.format')}</label>
        <div className="io-formats">
          {FORMATS.map((f) => {
            const disabled = f.value === 'bson' && !bsonReady
            return (
              <button
                key={f.value}
                type="button"
                className={`io-format${format === f.value ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => setFormat(f.value)}
              >
                {f.label}
              </button>
            )
          })}
        </div>
        {!bsonReady && (
          <div className="hint">
            {t('io.bsonHint')}
          </div>
        )}
      </div>

      {isJson && (
        <div className="form-row">
          <label className="io-check">
            <input
              type="checkbox"
              checked={jsonArray}
              onChange={(e) => setJsonArray(e.target.checked)}
            />
            <span>{t('io.jsonArray')}</span>
          </label>
        </div>
      )}

      <div className="form-row">
        <label htmlFor="export-query">{t('io.queryFilter')}</label>
        <textarea
          id="export-query"
          className="io-query"
          spellCheck={false}
          placeholder="{}"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!isBson && (
        <div className="form-row">
          <label htmlFor="export-limit">{t('io.limit')}</label>
          <input
            id="export-limit"
            type="number"
            min={1}
            placeholder={t('io.limitPlaceholder')}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
      )}

      {isBson && (
        <div className="hint">
          {t('io.bsonExportNote')}
        </div>
      )}

      {result && !result.ok && (
        <div className="io-result err">{result.error ?? t('io.exportFailed')}</div>
      )}
      {success && (
        <div className="io-result ok">
          {t('io.exportSuccess', { count: result?.count ?? 0, path: result?.filePath ?? '(unknown path)' })}
        </div>
      )}
    </Modal>
  )
}
