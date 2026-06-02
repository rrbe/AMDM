/**
 * A tiny modal that asks for a name and saves the current editor code as a
 * SavedQuery (bound to the active connection/database when available).
 */
import { useState } from 'react'
import { Modal } from '@renderer/components/common/Modal'
import { useAppStore } from '@renderer/store/useAppStore'

interface SaveQueryModalProps {
  onClose: () => void
}

export function SaveQueryModal({ onClose }: SaveQueryModalProps): JSX.Element {
  const code = useAppStore((s) => s.code)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const activeDatabase = useAppStore((s) => s.activeDatabase)
  const saveQuery = useAppStore((s) => s.saveQuery)

  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = name.trim().length > 0 && !saving

  const onSave = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    const saved = await saveQuery({
      name: name.trim(),
      code,
      connectionId: activeConnectionId ?? undefined,
      database: activeDatabase || undefined
    })
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <Modal
      title="Save Query"
      small
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave} onClick={() => void onSave()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="save-query-name">Name</label>
        <input
          id="save-query-name"
          autoFocus
          value={name}
          placeholder="e.g. active users"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSave()
          }}
        />
      </div>
      <code className="lib-code">{code.split('\n')[0]?.slice(0, 100) || '(empty)'}</code>
    </Modal>
  )
}
