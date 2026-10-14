/**
 * Import-into-a-collection modal.
 *
 * The main process opens an OS file picker, detects JSON / JSONL / CSV / TSV /
 * XLSX / BSON from the selected file, and ingests it via `importCollection`.
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
import type { DataOpResult } from '@shared/types'

interface ImportModalProps {
  connectionId: string
  database: string
  collection: string
  onClose: () => void
}

export function ImportModal({ connectionId, database, collection, onClose }: ImportModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const importCollection = useAppStore((s) => s.importCollection)

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DataOpResult | null>(null)

  const onImport = async (): Promise<void> => {
    setResult(null)
    setRunning(true)
    const res = await importCollection({ connectionId, database, collection })
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
      title={t('io.importTitle', { target: `${database}.${collection}` })}
      description={t('io.importDescription')}
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
