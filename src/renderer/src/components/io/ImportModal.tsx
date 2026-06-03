/**
 * Import-into-a-collection modal.
 *
 * The user picks a source format (JSON / CSV / XLSX / BSON); the main process
 * opens an OS file picker and ingests the chosen file via `importCollection`.
 * This component only collects the request and renders the returned
 * `DataOpResult`.
 *
 *  - BSON is driven by `mongorestore` (an archive). It's disabled when the tool
 *    is not installed. A BSON archive always restores to its ORIGINAL namespace,
 *    so the target collection here is ignored — we warn about that.
 *  - `res.cancelled` (user dismissed the file dialog) just closes the modal.
 *  - `res.ok` keeps the modal open showing a success summary (+ any warning).
 *  - otherwise the error is shown in a red box.
 */
import { useState } from 'react'
import { Modal } from '@renderer/components/common/Modal'
import { BusyButton } from '@renderer/components/common/BusyButton'
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

export function ImportModal({ connectionId, database, collection, onClose }: ImportModalProps): JSX.Element {
  const toolStatus = useAppStore((s) => s.toolStatus)
  const importCollection = useAppStore((s) => s.importCollection)

  const [format, setFormat] = useState<DataFormat>('json')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DataOpResult | null>(null)

  const bsonReady = Boolean(toolStatus?.mongorestore)
  const isBson = format === 'bson'

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
      title={`Import — ${database}.${collection}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>{success ? 'Close' : 'Cancel'}</button>
          {!success && (
            <BusyButton
              className="primary"
              busy={running}
              disabled={isBson && !bsonReady}
              onClick={() => void onImport()}
            >
              Import
            </BusyButton>
          )}
        </>
      }
    >
      <div className="form-row">
        <label>Format</label>
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
            Install MongoDB Database Tools (brew install mongodb-database-tools) to enable BSON.
          </div>
        )}
      </div>

      {isBson && (
        <div className="io-note warn">
          BSON archives restore to their ORIGINAL namespace; the target collection is ignored.
        </div>
      )}

      {result && !result.ok && (
        <div className="io-result err">{result.error ?? 'Import failed.'}</div>
      )}
      {success && (
        <div className="io-result ok">
          Imported {result?.count ?? 0} docs
          {result?.warning ? <div className="io-warning">{result.warning}</div> : null}
        </div>
      )}
    </Modal>
  )
}
