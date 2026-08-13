/**
 * Import-into-a-collection modal.
 *
 * The user picks a source format (JSON / CSV / XLSX / BSON); the main process
 * opens an OS file picker and ingests the chosen file via `importCollection`.
 * This component only collects the request and renders the returned
 * `DataOpResult`.
 *
 *  - BSON is read natively (plain `.bson`, gzip auto-detected) into the chosen
 *    target collection — no external tool, no namespace surprises.
 *  - `res.cancelled` (user dismissed the file dialog) just closes the modal.
 *  - `res.ok` keeps the modal open showing a success summary (+ any warning).
 *  - otherwise the error is shown in a red box.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { useAppStore } from '@renderer/store/useAppStore'
import type { DataFormat, DataOpResult } from '@shared/types'

interface ImportModalProps {
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

export function ImportModal({ connectionId, database, collection, onClose }: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const importCollection = useAppStore((s) => s.importCollection)

  const [format, setFormat] = useState<DataFormat>('json')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DataOpResult | null>(null)

  const onImport = async (): Promise<void> => {
    setResult(null)
    setRunning(true)
    const res = await importCollection({ connectionId, database, collection, format })
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
      title={t('io.importTitle', { ns: `${database}.${collection}` })}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{success ? t('io.close') : t('io.cancel')}</Button>
          {!success && (
            <Button variant="primary" busy={running} onClick={() => void onImport()}>
              {t('io.importBtn')}
            </Button>
          )}
        </>
      }
    >
      <div className="form-row">
        <label>{t('io.format')}</label>
        <div className="io-formats">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`io-format${format === f.value ? ' active' : ''}`}
              onClick={() => setFormat(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {result && !result.ok && (
        <div className="io-result err">{result.error ?? t('io.importFailed')}</div>
      )}
      {success && (
        <div className="io-result ok">
          {t('io.importSuccess', { count: result?.count ?? 0 })}
          {result?.warning ? <div className="io-warning">{result.warning}</div> : null}
        </div>
      )}
    </Modal>
  )
}
