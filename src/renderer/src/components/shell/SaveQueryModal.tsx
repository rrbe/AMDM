/**
 * A tiny modal that asks for a name and saves the current editor code as a
 * SavedQuery (bound to the active connection/database when available).
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'

interface SaveQueryModalProps {
  onClose: () => void
}

export function SaveQueryModal({ onClose }: SaveQueryModalProps): JSX.Element {
  const { t } = useTranslation()
  const code = useAppStore((s) => getActiveTab(s).code)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const activeDatabase = useAppStore((s) => getActiveTab(s).activeDatabase)
  const savedQueries = useAppStore((s) => s.savedQueries)
  const saveQuery = useAppStore((s) => s.saveQuery)

  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [saving, setSaving] = useState(false)

  // Existing folder names for the datalist (typing a new one creates it).
  const folders = useMemo(
    () => [...new Set(savedQueries.map((q) => q.folder).filter((f): f is string => !!f))].sort(),
    [savedQueries]
  )

  const canSave = name.trim().length > 0 && !saving

  const onSave = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    const saved = await saveQuery({
      name: name.trim(),
      code,
      connectionId: activeConnectionId ?? undefined,
      database: activeDatabase || undefined,
      folder: folder.trim() || undefined
    })
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <Modal
      title={t('saveQuery.title')}
      small
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{t('saveQuery.cancel')}</Button>
          <Button variant="primary" busy={saving} disabled={!canSave} onClick={() => void onSave()}>
            {t('saveQuery.save')}
          </Button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="save-query-name">{t('saveQuery.name')}</label>
        <input
          id="save-query-name"
          autoFocus
          value={name}
          placeholder={t('saveQuery.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSave()
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="save-query-folder">{t('saveQuery.folder')}</label>
        <input
          id="save-query-folder"
          list="save-query-folders"
          value={folder}
          placeholder={t('saveQuery.folderPlaceholder')}
          onChange={(e) => setFolder(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSave()
          }}
        />
        <datalist id="save-query-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      <code className="lib-code">{code.split('\n')[0]?.slice(0, 100) || t('saveQuery.empty')}</code>
    </Modal>
  )
}
